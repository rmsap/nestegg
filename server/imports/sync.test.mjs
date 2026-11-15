import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createConnection, deleteConnection, replaceCredential, setConnectionEnabled } from "../connections/mutations.ts";
import { initialize } from "../db/migrations.ts";
import { setSyncInterval } from "./provider-settings.ts";
import { syncConnection } from "./sync.ts";
import { ProviderError } from "./transaction-provider.ts";
import { decrypt } from "../secrets.ts";

const key = randomBytes(32);
const secret = "test_token_plaintext_9f3a";
const T0 = new Date("2026-11-10T12:00:00.000Z");
const later = (days, base = T0) => new Date(base.getTime() + days * 86_400_000);

function setup(t, { enable = true } = {}) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`INSERT INTO providers (key, name, default_sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES
    ('fixture', 'Fixture', 360, 15, 10), ('fixture-b', 'Fixture B', 360, 15, 10)`);
  const id = createConnection(db, 1, key, { provider: "fixture", label: "Fixture", credential: secret });
  if (enable) setConnectionEnabled(db, 1, id, true);
  const adapter = {
    key: "fixture", settings: [], calls: [], accounts: [], error: null,
    async fetchAccounts(ctx, credential, window) {
      adapter.calls.push({ ctx, credential, window });
      if (adapter.error) throw adapter.error;
      return adapter.accounts;
    },
  };
  const sync = (now = T0, options = {}) => syncConnection(db, key, id, adapter, { now, ...options });
  const rows = (sql, ...args) => db.prepare(sql).all(...args).map((row) => ({ ...row }));
  const one = (sql, ...args) => ({ ...db.prepare(sql).get(...args) });
  return { db, id, adapter, sync, rows, one };
}

const txn = (externalId, extra = {}) => ({
  externalId, date: "2026-11-08", description: "Market", amountCents: -2500, kind: "expense", pending: false, ...extra,
});
const account = (transactions = [], extra = {}) => ({
  externalId: "account-1", name: "Checking", kind: "bank", currency: "USD", balanceCents: 4200, transactions, ...extra,
});

test("the stored credential is encrypted and the adapter receives the plaintext", async (t) => {
  const { adapter, sync, one } = setup(t);
  const stored = one("SELECT credential_encrypted FROM connections").credential_encrypted;
  assert.ok(!stored.includes(secret));
  assert.equal(decrypt(key, "connection-credential", stored), secret);
  await sync();
  assert.equal(adapter.calls[0].credential, secret);
});

test("a first sync covers 730 days and a later sync starts lookback_days before the previous sync", async (t) => {
  const { adapter, sync, rows } = setup(t);
  await sync(T0);
  assert.deepEqual(adapter.calls[0].window, { start: "2024-11-10", end: "2026-11-10" });
  await sync(later(3));
  assert.deepEqual(adapter.calls[1].window, { start: "2026-10-31", end: "2026-11-13" });
  assert.deepEqual(rows("SELECT window_start, window_end FROM sync_runs ORDER BY id"), [
    { window_start: "2024-11-10", window_end: "2026-11-10" },
    { window_start: "2026-10-31", window_end: "2026-11-13" },
  ]);
});

test("a repeat sync is idempotent and preserves the user's category and review", async (t) => {
  const { db, adapter, sync, one } = setup(t);
  const purchase = txn("purchase-1", { pending: true });
  const entries = [
    purchase,
    txn("payment-1", { kind: "transfer" }),
    txn("purchase-2", { amountCents: -500 }),
  ];
  adapter.accounts = [account(entries)];
  const postedSpending = () => one("SELECT SUM(-amount_cents) AS spent FROM transactions WHERE kind = 'expense' AND pending = 0 AND removed_at IS NULL").spent;
  const count = (table) => one(`SELECT COUNT(*) AS count FROM ${table}`).count;

  const first = await sync();
  assert.deepEqual([first.accounts, first.added, first.updated, first.removed], [1, 3, 0, 0]);
  assert.equal(postedSpending(), 500);
  db.exec("INSERT INTO categories (id, user_id, name) VALUES (1, 1, 'Groceries')");
  db.exec("UPDATE transactions SET category_id = 1, reviewed = 1 WHERE external_id = 'purchase-1'");
  purchase.pending = false;
  purchase.date = "2026-11-09";
  purchase.amountCents = -2599;
  const second = await sync();
  assert.deepEqual([second.added, second.updated], [0, 1]);
  const third = await sync();
  assert.deepEqual([third.added, third.updated, third.removed], [0, 0, 0]);
  assert.equal(count("accounts"), 1);
  assert.equal(count("transactions"), 3);
  assert.equal(postedSpending(), 3099);
  assert.deepEqual(one("SELECT date, pending, category_id, reviewed FROM transactions WHERE external_id = 'purchase-1'"),
    { date: "2026-11-09", pending: 0, category_id: 1, reviewed: 1 });

  purchase.pending = true;
  await sync();
  assert.equal(postedSpending(), 3099);
  entries.push(txn("bad", { date: "2026-02-30" }));
  entries[2].amountCents = -700;
  await assert.rejects(sync(), /Invalid provider transaction/);
  assert.equal(postedSpending(), 3099);
  entries.pop();
  await sync();
  assert.equal(postedSpending(), 3299);
  assert.equal(count("transactions"), 3);
});

test("a pending row that posts updates in place and a posted row is not reverted to pending", async (t) => {
  const { adapter, sync, rows } = setup(t);
  adapter.accounts = [account([txn("a", { pending: true })])];
  await sync();
  adapter.accounts = [account([txn("a", { amountCents: -2650 })])];
  const posted = await sync();
  assert.deepEqual([posted.added, posted.updated], [0, 1]);
  assert.deepEqual(rows("SELECT amount_cents, pending FROM transactions"), [{ amount_cents: -2650, pending: 0 }]);
  adapter.accounts = [account([txn("a", { amountCents: -2500, pending: true })])];
  const again = await sync();
  assert.equal(again.updated, 0);
  assert.deepEqual(rows("SELECT amount_cents, pending FROM transactions"), [{ amount_cents: -2650, pending: 0 }]);
});

test("a vanished pending row inside the window is soft-removed and restored if it returns", async (t) => {
  const { adapter, sync, rows } = setup(t);
  const visible = () => rows("SELECT external_id FROM transactions WHERE removed_at IS NULL ORDER BY external_id").map((row) => row.external_id);
  adapter.accounts = [account([
    txn("pending-in", { pending: true }), txn("posted-in"), txn("pending-old", { pending: true, date: "2026-01-01" }),
  ])];
  await sync(T0);
  adapter.accounts = [account([])];
  const result = await sync(later(3));
  assert.equal(result.removed, 1);
  assert.deepEqual(visible(), ["pending-old", "posted-in"]);
  const removedAt = rows("SELECT removed_at FROM transactions WHERE external_id = 'pending-in'")[0].removed_at;
  assert.equal(removedAt, later(3).toISOString());

  const quiet = await sync(later(4));
  assert.equal(quiet.removed, 0);
  adapter.accounts = [account([txn("pending-in", { pending: true })])];
  const restored = await sync(later(5));
  assert.equal(restored.updated, 1);
  assert.ok(visible().includes("pending-in"));
});

test("an invalid transaction rolls back the whole apply and fails the run", async (t) => {
  const { adapter, sync, rows, one } = setup(t);
  adapter.accounts = [account([txn("a")])];
  await sync(T0);
  adapter.accounts = [
    account([txn("a", { amountCents: -1 }), txn("b"), txn("bad", { date: "2026-02-30" })], { balanceCents: 1 }),
    account([], { externalId: "account-2", name: "Savings" }),
  ];
  await assert.rejects(sync(later(1)), /Invalid provider transaction/);
  assert.deepEqual(rows("SELECT external_id, amount_cents FROM transactions"), [{ external_id: "a", amount_cents: -2500 }]);
  assert.deepEqual(rows("SELECT external_id, balance_cents FROM accounts"), [{ external_id: "account-1", balance_cents: 4200 }]);
  assert.equal(rows("SELECT * FROM balance_snapshots").length, 1);
  const connection = one("SELECT status, last_synced_at, last_error FROM connections");
  assert.deepEqual(connection, { status: "error", last_synced_at: T0.toISOString(), last_error: "Invalid provider transaction" });
  assert.deepEqual(rows("SELECT status, error FROM sync_runs ORDER BY id"), [
    { status: "ok", error: null }, { status: "failed", error: "Invalid provider transaction" },
  ]);
  assert.equal(rows("SELECT * FROM events WHERE type = 'sync.failed' AND severity = 'error'").length, 1);
});

test("an auth failure needs re-authorization and a later success restores the connection", async (t) => {
  const { adapter, sync, rows, one } = setup(t);
  adapter.accounts = [account()];
  await sync(T0);
  adapter.error = new ProviderError("auth", "Provider rejected the credential");
  await assert.rejects(sync(later(1)), { kind: "auth" });
  assert.deepEqual(one("SELECT status, last_synced_at, last_error FROM connections"),
    { status: "needs_reauth", last_synced_at: T0.toISOString(), last_error: "Provider rejected the credential" });
  assert.equal(rows("SELECT * FROM events WHERE type = 'connection.needs_reauth' AND severity = 'error'").length, 1);
  assert.equal(rows("SELECT * FROM events WHERE type = 'sync.failed'").length, 0);
  adapter.error = null;
  await sync(later(2));
  assert.deepEqual(one("SELECT status, last_error, last_synced_at FROM connections"),
    { status: "active", last_error: null, last_synced_at: later(2).toISOString() });
});

test("no credential text is stored after a failure that embeds it", async (t) => {
  const { adapter, sync, rows } = setup(t);
  adapter.accounts = [account()];
  await sync(T0);
  for (const error of [new Error("boom " + secret), new ProviderError("unavailable", "failed with " + secret)]) {
    adapter.error = error;
    await assert.rejects(sync(later(1)), (thrown) => !thrown.message.includes(secret));
  }
  adapter.error = null;
  const text = JSON.stringify([
    rows("SELECT * FROM events"), rows("SELECT * FROM sync_runs"),
    rows("SELECT id, provider, label, status, enabled, last_synced_at, last_error FROM connections"),
  ]);
  assert.ok(!text.includes(secret));
  assert.equal(rows("SELECT * FROM sync_runs WHERE status = 'failed'").length, 2);
});

test("a sync that cannot start is refused without a run", async (t) => {
  const refuse = async (prepare, pattern) => {
    const env = setup(t);
    prepare(env);
    await assert.rejects(env.sync(), pattern);
    assert.equal(env.rows("SELECT * FROM sync_runs").length, 0);
    assert.equal(env.adapter.calls.length, 0);
  };
  await refuse(({ db }) => db.exec("UPDATE connections SET enabled = 0"), /disabled/);
  await refuse(({ db }) => db.exec("UPDATE connections SET credential_encrypted = NULL"), /no credential/);
  await refuse(({ db }) => db.exec("INSERT INTO user_providers (user_id, provider, enabled, sync_interval_minutes) VALUES (1, 'fixture', 0, 360)"), /provider is disabled/);
  await refuse(({ adapter }) => { adapter.key = "fixture-b"; }, /does not match/);
  await assert.rejects(syncConnection(setup(t).db, key, 99, { key: "fixture" }, { now: T0 }), /Unknown connection/);
});

test("a recent running sync blocks a new one and a stale one is marked interrupted", async (t) => {
  const { db, id, adapter, sync, rows } = setup(t);
  adapter.accounts = [account()];
  const run = db.prepare("INSERT INTO sync_runs (connection_id, started_at) VALUES (?, ?) RETURNING id");
  const recent = Number(run.get(id, new Date(T0.getTime() - 5 * 60_000).toISOString()).id);
  await assert.rejects(sync(), /already running/);
  assert.equal(rows("SELECT * FROM sync_runs").length, 1);
  db.prepare("UPDATE sync_runs SET started_at = ? WHERE id = ?").run(new Date(T0.getTime() - 20 * 60_000).toISOString(), recent);
  const result = await sync();
  assert.equal(result.added, 0);
  assert.deepEqual(rows("SELECT id, status, error FROM sync_runs ORDER BY id"), [
    { id: recent, status: "failed", error: "Interrupted" }, { id: result.syncRunId, status: "ok", error: null },
  ]);
});

test("a user-changed class survives a sync and a foreign currency fails the run", async (t) => {
  const { db, adapter, sync, one, rows } = setup(t);
  adapter.accounts = [account()];
  await sync(T0);
  assert.equal(one("SELECT class FROM accounts").class, "asset");
  db.exec("UPDATE accounts SET class = 'liability'");
  await sync(later(1));
  assert.equal(one("SELECT class FROM accounts").class, "liability");
  adapter.accounts = [account([], { currency: "EUR" })];
  await assert.rejects(sync(later(2)), /unsupported currency/);
  assert.equal(one("SELECT currency FROM accounts").currency, "USD");
  assert.equal(rows("SELECT * FROM sync_runs WHERE status = 'failed'").length, 1);
});

test("a balance snapshot is written once per account per day and updated by a same-day sync", async (t) => {
  const { adapter, sync, rows } = setup(t);
  adapter.accounts = [account(), account([], { externalId: "account-2", name: "Card", kind: "credit_card", balanceCents: 900 }),
    account([], { externalId: "account-3", name: "Unknown", balanceCents: null })];
  await sync(T0);
  assert.equal(rows("SELECT * FROM balance_snapshots").length, 2);
  adapter.accounts[0].balanceCents = 5000;
  await sync(new Date("2026-11-10T18:00:00.000Z"));
  assert.deepEqual(rows("SELECT account_id, date, balance_cents FROM balance_snapshots ORDER BY account_id"), [
    { account_id: 1, date: "2026-11-10", balance_cents: 5000 }, { account_id: 2, date: "2026-11-10", balance_cents: 900 },
  ]);
  assert.equal(rows("SELECT class FROM accounts WHERE external_id = 'account-2'")[0].class, "liability");
  await sync(later(1));
  assert.equal(rows("SELECT * FROM balance_snapshots").length, 4);
});

test("connection management validates input and records events", (t) => {
  const { db, id, rows, one } = setup(t, { enable: false });
  assert.equal(one("SELECT enabled, status FROM connections").enabled, 0);
  assert.equal(one("SELECT status FROM connections").status, "active");
  assert.throws(() => createConnection(db, 1, key,{ provider: "nope", label: "x", credential: "c" }), /Unknown provider/);
  assert.throws(() => createConnection(db, 1, key,{ provider: "fixture", label: "  ", credential: "c" }), /Label/);
  assert.throws(() => createConnection(db, 1, key,{ provider: "fixture", label: "x".repeat(81), credential: "c" }), /Label/);
  db.exec("INSERT INTO user_providers (user_id, provider, enabled, sync_interval_minutes) VALUES (1, 'fixture-b', 0, 360)");
  assert.throws(() => createConnection(db, 1, key, { provider: "fixture-b", label: "x", credential: "c" }), /disabled/);

  db.exec("UPDATE connections SET credential_encrypted = NULL");
  assert.throws(() => setConnectionEnabled(db, 1, id, true), /credential/);
  assert.throws(() => setConnectionEnabled(db, 1, 99, true), /not found/);
  replaceCredential(db, 1, key, id, "new-secret");
  assert.equal(decrypt(key, "connection-credential", one("SELECT credential_encrypted FROM connections").credential_encrypted), "new-secret");
  setConnectionEnabled(db, 1, id, true);
  setConnectionEnabled(db, 1, id, false);

  assert.throws(() => setSyncInterval(db, 1, "fixture", 14), /15 to 10080/);
  assert.throws(() => setSyncInterval(db, 1, "fixture", 20000), /10080/);
  assert.throws(() => setSyncInterval(db, 1, "fixture", 30.5), /whole number/);
  setSyncInterval(db, 1, "fixture", 30);
  assert.equal(one("SELECT sync_interval_minutes AS minutes FROM user_providers WHERE user_id = ? AND provider = 'fixture'", 1).minutes, 30);

  db.prepare("INSERT INTO accounts (id, user_id, name, kind, class, connection_id, external_id) VALUES (1, 1, 'Checking', 'bank', 'asset', ?, 'a')").run(id);
  deleteConnection(db, 1, id);
  assert.throws(() => deleteConnection(db, 1, id), /not found/);
  assert.equal(one("SELECT connection_id FROM accounts WHERE id = 1").connection_id, null);
  assert.deepEqual(rows("SELECT type, severity FROM events ORDER BY id").map((row) => row.type), [
    "connection.created", "connection.credential_replaced", "connection.enabled", "connection.disabled",
    "provider.interval_changed", "connection.deleted",
  ]);
  assert.equal(JSON.parse(one("SELECT detail FROM events WHERE type = 'connection.deleted'").detail).label, "Fixture");
  assert.ok(!JSON.stringify(rows("SELECT * FROM events")).includes("new-secret"));
});

test("a scheduled sync is attributed to the scheduler and stores its job run", async (t) => {
  const { db, adapter, sync, one } = setup(t);
  adapter.accounts = [account()];
  db.exec("INSERT INTO job_runs (id, job_key, trigger) VALUES (5, 'sync-connections', 'schedule')");
  await sync(T0, { trigger: "schedule", jobRunId: 5 });
  assert.equal(one("SELECT job_run_id FROM sync_runs").job_run_id, 5);
  assert.equal(one("SELECT actor FROM events WHERE type = 'sync.completed'").actor, "scheduler");
});

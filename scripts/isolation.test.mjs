import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { accounts } from "../server/accounts/queries.ts";
import { budgetIncome, categories, uncategorizedSpending } from "../server/budget/queries.ts";
import { insertCategory, removeCategory, updateLimits } from "../server/budget/mutations.ts";
import {
  beginConnection, completeConnection, createConnection, deleteConnection, disconnectAndDelete, replaceCredential, setConnectionEnabled,
} from "../server/connections/mutations.ts";
import { connectionAccounts, connectionList, providerList, readouts, recentEvents, recentRuns } from "../server/connections/queries.ts";
import { initialize } from "../server/db/migrations.ts";
import { demo } from "../server/imports/demo.ts";
import {
  describeProviderSettings, providerSettings, setProviderEnabled, setProviderSettings, setSyncInterval,
} from "../server/imports/provider-settings.ts";
import { syncConnection } from "../server/imports/sync.ts";
import { syncDueConnections } from "../server/schedule/sync-job.ts";
import { decrypt } from "../server/secrets.ts";
import { transactions } from "../server/transactions/queries.ts";
import { saveReview } from "../server/transactions/mutations.ts";
import { userPrimaryColor } from "../server/users/users.ts";

const key = randomBytes(32);
const T0 = new Date("2026-11-10T12:00:00.000Z");
const MONTH = "2026-11";
const EXPIRED = "This link attempt has expired. Start again.";
const GONE = 999_999;

const rows = (db, sql, ...args) => db.prepare(sql).all(...args).map((row) => ({ ...row }));
const count = (db, sql, ...args) => Number(db.prepare(sql).get(...args).n);
const addUser = (db, role = "member") => Number(db.prepare("INSERT INTO users (role) VALUES (?) RETURNING id").get(role).id);
const message = (work) => {
  try {
    work();
  } catch (error) {
    return error.message;
  }
  assert.fail("expected an error");
};
const messageAsync = async (work) => {
  try {
    await work();
  } catch (error) {
    return error.message;
  }
  assert.fail("expected an error");
};

function open(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  return db;
}

function household(db, user, tag, income) {
  const credential = JSON.stringify({ name: tag + " Bank", scenario: "healthy", seed: tag.repeat(6) });
  const connection = createConnection(db, user, key, { provider: "demo", label: tag + " Bank", credential });
  setConnectionEnabled(db, user, connection, true);
  const account = Number(db.prepare(`INSERT INTO accounts (user_id, name, kind, class, balance_cents, connection_id, external_id)
    VALUES (?, ?, 'bank', 'asset', 1000, ?, 'x') RETURNING id`).get(user, tag + " Checking", connection).id);
  insertCategory(db, user, tag + " Food", MONTH, 5000);
  const category = Number(db.prepare("SELECT id FROM categories WHERE user_id = ?").get(user).id);
  db.prepare("UPDATE budget_months SET expected_income_cents = ? WHERE user_id = ? AND month = ?").run(income, user, MONTH);
  const add = (merchant, amount, categoryId) => Number(db.prepare(`INSERT INTO transactions (date, merchant, account_id, amount_cents, category_id, kind)
    VALUES ('2026-11-05', ?, ?, ?, ?, 'expense') RETURNING id`).get(tag + " " + merchant, account, amount, categoryId).id);
  const transaction = add("Market", -700, category);
  const loose = add("Cash", -300, null);
  db.prepare("INSERT INTO sync_runs (connection_id, status) VALUES (?, 'ok')").run(connection);
  db.prepare("INSERT INTO balance_snapshots (account_id, date, balance_cents) VALUES (?, '2026-11-05', 1000)").run(account);
  return { user, tag, income, connection, account, category, transaction, loose };
}

function world(t) {
  const db = open(t);
  const a = household(db, addUser(db, "admin"), "Alpha", 111_000);
  const b = household(db, addUser(db), "Bravo", 222_000);
  return { db, a, b };
}

function owned(db, user) {
  const through = (table, parent, column) => rows(db, `SELECT * FROM ${table} WHERE ${column} IN (SELECT id FROM ${parent} WHERE user_id = ?) ORDER BY 1, 2`, user);
  return JSON.stringify({
    user: rows(db, "SELECT id, role, currency, primary_color FROM users WHERE id = ?", user),
    connections: rows(db, "SELECT * FROM connections WHERE user_id = ? ORDER BY id", user),
    accounts: rows(db, "SELECT * FROM accounts WHERE user_id = ? ORDER BY id", user),
    transactions: through("transactions", "accounts", "account_id"),
    snapshots: through("balance_snapshots", "accounts", "account_id"),
    runs: through("sync_runs", "connections", "connection_id"),
    categories: rows(db, "SELECT * FROM categories WHERE user_id = ? ORDER BY id", user),
    months: rows(db, "SELECT * FROM budget_months WHERE user_id = ? ORDER BY month", user),
    limits: rows(db, "SELECT * FROM budget_limits WHERE user_id = ? ORDER BY month, category_id", user),
    events: rows(db, "SELECT * FROM events WHERE user_id = ? ORDER BY id", user),
    providers: rows(db, "SELECT * FROM user_providers WHERE user_id = ? ORDER BY provider", user),
    matchers: rows(db, "SELECT * FROM notification_matchers WHERE user_id = ? ORDER BY id", user),
  });
}

test("every read returns only the asking user's rows", (t) => {
  const { db, a, b } = world(t);
  db.exec(`INSERT INTO accounts (user_id, name, kind, class, closed_at) VALUES (${a.user}, 'Alpha Closed', 'bank', 'asset', '2026-01-01')`);
  // A transaction whose category belongs to someone else must not count towards, or be named after, that category.
  db.prepare("INSERT INTO transactions (date, merchant, account_id, amount_cents, category_id, kind) VALUES ('2026-11-06', 'Stray', ?, -5000, ?, 'expense')").run(b.account, a.category);
  for (const [me, other] of [[a, b], [b, a]]) {
    const ids = (list) => list.map((item) => item.id);
    assert.deepEqual(ids(accounts(db, me.user)), rows(db, "SELECT id FROM accounts WHERE user_id = ? ORDER BY id", me.user).map((row) => row.id));
    assert.ok(!ids(accounts(db, me.user)).includes(other.account));
    const list = categories(db, me.user, MONTH);
    assert.deepEqual(list.map((item) => [item.id, item.name, item.limit_cents, item.spent, item.activity]),
      me === a ? [[a.category, "Alpha Food", 5000, 700, 1]] : [[b.category, "Bravo Food", 5000, 700, 1]]);
    assert.equal(budgetIncome(db, me.user, MONTH), me.income);
    assert.equal(budgetIncome(db, me.user, "2026-09"), 0);
    assert.equal(uncategorizedSpending(db, me.user, MONTH), 300);
    const listed = transactions(db, me.user, MONTH);
    assert.ok(listed.every((item) => item.merchant.startsWith(me.tag) || item.merchant === "Stray"));
    assert.equal(listed.some((item) => item.id === other.transaction), false);
    assert.equal(listed.find((item) => item.merchant === "Stray")?.category, me === b ? "Uncategorized" : undefined);
    assert.deepEqual(connectionList(db, me.user).map((item) => item.id), [me.connection]);
    assert.deepEqual([...connectionAccounts(db, me.user).keys()], [me.connection]);
    assert.deepEqual(readouts(db, me.user), { connections: 1, accounts: 1, lastSyncedAt: null, needAttention: 0 });
    assert.equal(recentRuns(db, me.user, me.connection).length, 1);
    assert.deepEqual(recentRuns(db, me.user, other.connection), []);
    const events = recentEvents(db, me.user, 50);
    assert.equal(events.length, count(db, "SELECT COUNT(*) AS n FROM events WHERE user_id = ?", me.user));
    assert.ok(events.every((event) => event.connection === me.tag + " Bank"));
    assert.deepEqual(providerList(db, me.user).map((row) => row.key), ["demo", "plaid", "simplefin"]);
    assert.deepEqual(providerSettings(db, me.user, key, "demo"), {});
    assert.equal(userPrimaryColor(db, me.user), "#245e49");
  }
  assert.deepEqual(accounts(db, GONE), []);
  assert.deepEqual(categories(db, GONE, MONTH), []);
  assert.deepEqual(transactions(db, GONE, MONTH), []);
  assert.deepEqual(connectionList(db, GONE), []);
  assert.deepEqual(recentEvents(db, GONE), []);
  assert.equal(budgetIncome(db, GONE, MONTH), 0);
});

test("every by-id write on another user's row behaves like a missing id and changes nothing", async (t) => {
  const { db, a, b } = world(t);
  const issued = await beginConnection(db, b.user, key, demo, { now: T0 });
  const repair = await beginConnection(db, b.user, key, demo, { connectionId: b.connection, now: T0 });
  const payload = { name: "Hijack", scenario: "healthy" };
  assert.equal(await completeConnection(db, b.user, key, demo, issued.state, { ...payload, name: "Bravo Second" }, { now: T0 }) > 0, true);
  const before = owned(db, b.user);
  const stored = db.prepare("SELECT credential_encrypted FROM connections WHERE id = ?").get(b.connection).credential_encrypted;

  assert.equal(saveReview(db, a.user, b.transaction, { memo: "mine now" }), false);
  assert.equal(saveReview(db, a.user, GONE, { memo: "mine now" }), false);
  assert.equal(saveReview(db, a.user, b.transaction, { categoryId: a.category }), false);
  assert.equal(saveReview(db, a.user, b.transaction, { categoryId: null }), false);
  assert.equal(saveReview(db, a.user, a.transaction, { categoryId: b.category }), false);
  assert.equal(saveReview(db, a.user, a.transaction, { categoryId: GONE }), false);
  assert.deepEqual(rows(db, "SELECT category_id, reviewed, memo FROM transactions WHERE id = ?", a.transaction), [{ category_id: a.category, reviewed: 0, memo: null }]);

  assert.equal(removeCategory(db, a.user, b.category, a.category), "missing");
  assert.equal(removeCategory(db, a.user, GONE, a.category), "missing");
  assert.equal(removeCategory(db, a.user, a.category, b.category), "replacement-required");
  assert.equal(removeCategory(db, a.user, a.category, GONE), "replacement-required");
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM categories WHERE id = ?", a.category), 1);

  assert.equal(updateLimits(db, a.user, MONTH, [{ id: b.category, limit: 1 }]), undefined);
  assert.equal(updateLimits(db, a.user, MONTH, [{ id: GONE, limit: 1 }]), undefined);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM budget_limits WHERE category_id = ?", b.category), 1);

  const missing = "Connection not found";
  for (const work of [
    (id) => setConnectionEnabled(db, a.user, id, false),
    (id) => setConnectionEnabled(db, a.user, id, true),
    (id) => replaceCredential(db, a.user, key, id, "stolen"),
    (id) => deleteConnection(db, a.user, id),
  ]) {
    assert.equal(message(() => work(b.connection)), missing);
    assert.equal(message(() => work(GONE)), missing);
  }
  assert.equal(await messageAsync(() => disconnectAndDelete(db, a.user, key, demo, b.connection)), missing);
  assert.equal(await messageAsync(() => disconnectAndDelete(db, a.user, key, demo, GONE)), missing);
  assert.equal(await messageAsync(() => beginConnection(db, a.user, key, demo, { connectionId: b.connection, now: T0 })), missing);
  assert.equal(await messageAsync(() => beginConnection(db, a.user, key, demo, { connectionId: GONE, now: T0 })), missing);

  const expected = await messageAsync(() => completeConnection(db, a.user, key, demo, "garbage", payload, { now: T0 }));
  assert.equal(expected, EXPIRED);
  assert.equal(await messageAsync(() => completeConnection(db, a.user, key, demo, issued.state, payload, { now: T0 })), EXPIRED);
  assert.equal(await messageAsync(() => completeConnection(db, a.user, key, demo, repair.state, payload, { now: T0 })), EXPIRED);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM connections WHERE label = 'Hijack'"), 0);
  assert.equal(decrypt(key, "connection-credential", db.prepare("SELECT credential_encrypted FROM connections WHERE id = ?").get(b.connection).credential_encrypted),
    decrypt(key, "connection-credential", stored));
  assert.equal(owned(db, b.user), before);
});

test("two users can each have a category with the same name and a budget for the same month", (t) => {
  const db = open(t);
  const [a, b] = [addUser(db, "admin"), addUser(db)];
  assert.equal(insertCategory(db, a, "Food", MONTH, 10_000), true);
  assert.equal(insertCategory(db, b, "food", MONTH, 20_000), true);
  assert.equal(insertCategory(db, a, "FOOD", MONTH, 30_000), false);
  assert.deepEqual(categories(db, a, MONTH).map((item) => [item.name, item.limit_cents]), [["Food", 10_000]]);
  assert.deepEqual(categories(db, b, MONTH).map((item) => [item.name, item.limit_cents]), [["food", 20_000]]);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM budget_months WHERE month = ?", MONTH), 2);
  const [first] = categories(db, a, MONTH);
  updateLimits(db, b, MONTH, [{ id: first.id, limit: 1 }]);
  assert.equal(categories(db, a, MONTH)[0].limit_cents, 10_000);
  updateLimits(db, a, MONTH, [{ id: first.id, limit: 11_000 }]);
  assert.deepEqual([categories(db, a, MONTH)[0].limit_cents, categories(db, b, MONTH)[0].limit_cents], [11_000, 20_000]);
  assert.equal(removeCategory(db, a, first.id, 0), "deleted");
  assert.equal(categories(db, b, MONTH).length, 1);
  assert.throws(() => db.prepare("INSERT INTO budget_limits (user_id, month, category_id, limit_cents) VALUES (?, '2030-01', 1, 1)").run(a), /FOREIGN KEY/);
});

const field = { name: "token", label: "Token", kind: "secret", required: true };

function fixture(extra = {}) {
  const adapter = {
    key: "fixture", settings: [field], calls: [], currency: "USD",
    async fetchAccounts(ctx, credential) {
      adapter.calls.push(credential);
      return [{ externalId: "acc-" + credential, name: "Account " + credential, kind: "bank", currency: adapter.currency, balanceCents: 100,
        transactions: [{ externalId: "t-" + credential, date: "2026-11-08", description: "Shop " + credential, amountCents: -500, kind: "expense", pending: false }] }];
    },
    ...extra,
  };
  return adapter;
}

function pair(t) {
  const db = open(t);
  db.exec("INSERT INTO providers (key, name, default_sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES ('fixture', 'Fixture', 360, 15, 10)");
  const a = addUser(db, "admin"), b = addUser(db);
  const connect = (user, credential) => {
    const id = createConnection(db, user, key, { provider: "fixture", label: "Conn " + credential, credential });
    setConnectionEnabled(db, user, id, true);
    return id;
  };
  const run = (adapter, now = T0) => {
    const jobRunId = Number(db.prepare("INSERT INTO job_runs (job_key, trigger) VALUES ('sync-connections', 'schedule') RETURNING id").get().id);
    return syncDueConnections(db, key, new Map([["fixture", adapter]]), { jobRunId, trigger: "schedule", now });
  };
  return { db, a, b, connect, run };
}

test("provider settings, enabled state and sync interval belong to one user", async (t) => {
  const { db, a, b, connect, run } = pair(t);
  const adapter = fixture();
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM user_providers WHERE user_id IN (?, ?)", a, b), 0);
  const effective = (user) => providerList(db, user).find((row) => row.key === "fixture");
  assert.deepEqual(effective(b), { key: "fixture", name: "Fixture", enabled: 1, sync_interval_minutes: 360, min_sync_interval_minutes: 15, configured: false });

  setProviderSettings(db, a, key, adapter, { token: "a-secret-token" });
  assert.equal(effective(a).configured, true);
  assert.equal(effective(b).configured, false);
  assert.deepEqual(providerSettings(db, a, key, "fixture"), { token: "a-secret-token" });
  assert.deepEqual(providerSettings(db, b, key, "fixture"), {});
  assert.deepEqual(describeProviderSettings(db, b, key, adapter), [{ ...field, set: false }]);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM user_providers WHERE user_id = ?", b), 0);

  assert.throws(() => setSyncInterval(db, a, "fixture", 14), /15 to 10080/);
  assert.throws(() => setSyncInterval(db, b, "fixture", 20_000), /10080/);
  setSyncInterval(db, a, "fixture", 30);
  assert.deepEqual([effective(a).sync_interval_minutes, effective(b).sync_interval_minutes], [30, 360]);
  assert.equal(providerSettings(db, a, key, "fixture").token, "a-secret-token");
  setSyncInterval(db, b, "fixture", 45);
  assert.deepEqual([effective(a).sync_interval_minutes, effective(b).sync_interval_minutes], [30, 45]);
  assert.equal(effective(b).configured, false);

  const connectionA = connect(a, "A"), connectionB = connect(b, "B");
  setProviderEnabled(db, a, "fixture", false);
  assert.deepEqual([effective(a).enabled, effective(b).enabled], [0, 1]);
  assert.equal(message(() => createConnection(db, a, key, { provider: "fixture", label: "Nope", credential: "x" })), "This provider is disabled");
  assert.ok(createConnection(db, b, key, { provider: "fixture", label: "Fine", credential: "x" }) > 0);
  assert.deepEqual(await run(adapter), { synced: 1, failed: 0 });
  assert.deepEqual(rows(db, "SELECT connection_id FROM sync_runs"), [{ connection_id: connectionB }]);
  assert.deepEqual(adapter.calls, ["B"]);
  assert.equal(await messageAsync(() => syncConnection(db, key, connectionA, adapter, { now: T0 })), "This provider is disabled");

  setProviderEnabled(db, a, "fixture", true);
  assert.deepEqual(await run(adapter, new Date(T0.getTime() + 31 * 60_000)), { synced: 1, failed: 0 });
  assert.deepEqual(adapter.calls, ["B", "A"]);
  assert.deepEqual(await run(adapter, new Date(T0.getTime() + 46 * 60_000)), { synced: 1, failed: 0 });
  assert.deepEqual(adapter.calls, ["B", "A", "B"]);
});

test("one scheduled run syncs both users and attributes accounts and events to each", async (t) => {
  const { db, a, b, connect, run } = pair(t);
  const adapter = fixture();
  const connectionA = connect(a, "A"), connectionB = connect(b, "B");
  assert.deepEqual(await run(adapter), { synced: 2, failed: 0 });
  assert.deepEqual(rows(db, "SELECT user_id, external_id, connection_id FROM accounts ORDER BY id"), [
    { user_id: a, external_id: "acc-A", connection_id: connectionA }, { user_id: b, external_id: "acc-B", connection_id: connectionB },
  ]);
  assert.deepEqual(rows(db, "SELECT user_id, connection_id, actor FROM events WHERE type = 'sync.completed' ORDER BY id"), [
    { user_id: a, connection_id: connectionA, actor: "scheduler" }, { user_id: b, connection_id: connectionB, actor: "scheduler" },
  ]);
  assert.deepEqual(rows(db, "SELECT a.user_id, t.merchant FROM transactions t JOIN accounts a ON a.id = t.account_id ORDER BY t.id"), [
    { user_id: a, merchant: "Shop A" }, { user_id: b, merchant: "Shop B" },
  ]);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM events WHERE type LIKE 'connection.%' AND user_id IS NOT NULL"), 4);
  assert.deepEqual(recentEvents(db, a).map((event) => event.connection), ["Conn A", "Conn A", "Conn A"]);
});

test("a sync fails when the account currency differs from its user's currency, whatever another user has", async (t) => {
  const { db, a, b, connect, run } = pair(t);
  const adapter = fixture();
  db.prepare("UPDATE users SET currency = 'EUR' WHERE id = ?").run(a);
  const connectionA = connect(a, "A"), connectionB = connect(b, "B");
  assert.deepEqual(await run(adapter), { synced: 1, failed: 1 });
  assert.deepEqual(rows(db, "SELECT connection_id, status, error FROM sync_runs ORDER BY connection_id"), [
    { connection_id: connectionA, status: "failed", error: "Invalid provider account or unsupported currency" },
    { connection_id: connectionB, status: "ok", error: null },
  ]);
  assert.deepEqual(rows(db, "SELECT user_id FROM accounts"), [{ user_id: b }]);
  assert.deepEqual(rows(db, "SELECT user_id, type FROM events WHERE type IN ('sync.failed', 'sync.completed') ORDER BY id"), [
    { user_id: a, type: "sync.failed" }, { user_id: b, type: "sync.completed" },
  ]);
  adapter.currency = "EUR";
  assert.deepEqual(await run(adapter, new Date(T0.getTime() + 361 * 60_000)), { synced: 1, failed: 1 });
  assert.deepEqual(rows(db, "SELECT user_id, currency FROM accounts ORDER BY id"), [{ user_id: b, currency: "USD" }, { user_id: a, currency: "EUR" }]);
});

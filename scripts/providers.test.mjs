import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { beginConnection, completeConnection, createConnection, disconnectAndDelete, setConnectionEnabled } from "../server/connections/mutations.ts";
import { initialize, migrations } from "../server/db/migrations.ts";
import { demo } from "../server/imports/demo.ts";
import { describeProviderSettings, providerSettings, setProviderEnabled, setProviderSettings } from "../server/imports/provider-settings.ts";
import { syncConnection } from "../server/imports/sync.ts";
import { decrypt } from "../server/secrets.ts";
import { checkAdapter } from "./adapter-contract.mjs";

const key = randomBytes(32);
const T0 = new Date("2026-11-10T12:00:00.000Z");
const later = (days, base = T0) => new Date(base.getTime() + days * 86_400_000);
const text = (value) => JSON.stringify(value);

const fields = [
  { name: "host", label: "Host", kind: "text", required: true },
  { name: "mode", label: "Mode", kind: "choice", required: false, choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
  { name: "token", label: "Token", kind: "secret", required: true },
  { name: "pem", label: "Certificate", kind: "file", required: false },
];
const values = { host: "host.example.invalid", mode: "a", token: "tok_plain_77aa", pem: "PEM_PLAIN_55bb" };

function fixture(providerKey = "fixture", extra = {}) {
  const adapter = {
    key: providerKey, settings: fields, calls: [], accounts: [], disconnected: [],
    async beginConnect(ctx, existing) {
      adapter.calls.push({ step: "begin", ctx, existing });
      return { kind: "form", fields: [] };
    },
    async completeConnect(ctx, payload, existing) {
      adapter.calls.push({ step: "complete", ctx, payload, existing });
      return { credential: "cred-" + (adapter.calls.length), label: "Fixture Bank" };
    },
    async fetchAccounts(ctx, credential, window) {
      adapter.calls.push({ step: "fetch", ctx, credential, window });
      return adapter.accounts;
    },
    async disconnect(ctx, credential) {
      adapter.disconnected.push(credential);
    },
    ...extra,
  };
  return adapter;
}

function setup(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`INSERT INTO providers (key, name, default_sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES
    ('fixture', 'Fixture', 360, 15, 10), ('fixture-b', 'Fixture B', 360, 15, 10)`);
  const rows = (sql, ...args) => db.prepare(sql).all(...args).map((row) => ({ ...row }));
  const one = (sql, ...args) => ({ ...db.prepare(sql).get(...args) });
  return { db, rows, one };
}

test("upgrading a version 8 database keeps transactions and adds the new columns", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const migration of migrations.slice(0, 8)) db.exec(migration.sql);
  db.exec("PRAGMA user_version = 8");
  db.exec(`
    INSERT INTO accounts (id, name, kind, class) VALUES (1, 'Checking', 'bank', 'asset');
    INSERT INTO transactions (id, date, merchant, account_id, amount_cents, kind, memo) VALUES (1, '2026-11-01', 'Market', 1, -900, 'expense', 'Weekly shop');
  `);
  initialize(db);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, migrations.length);
  assert.deepEqual({ ...db.prepare("SELECT id, merchant, amount_cents, memo, counterparty, provider_category FROM transactions").get() },
    { id: 1, merchant: "Market", amount_cents: -900, memo: "Weekly shop", counterparty: null, provider_category: null });
  assert.deepEqual({ ...db.prepare(`SELECT p.name, u.enabled, u.sync_interval_minutes, p.min_sync_interval_minutes, p.lookback_days, u.settings_encrypted
    FROM providers p JOIN user_providers u ON u.provider = p.key AND u.user_id = ? WHERE p.key = 'demo'`).get(1) },
    { name: "Demo Bank", enabled: 1, sync_interval_minutes: 60, min_sync_interval_minutes: 1, lookback_days: 10, settings_encrypted: null });
});

test("provider settings round-trip through encryption", (t) => {
  const { db } = setup(t);
  const adapter = fixture();
  assert.deepEqual(providerSettings(db, 1, key,"fixture"), {});
  setProviderSettings(db, 1, key,adapter, values);
  assert.deepEqual(providerSettings(db, 1, key,"fixture"), values);
});

test("describing provider settings never returns secret or file values", (t) => {
  const { db } = setup(t);
  const adapter = fixture();
  setProviderSettings(db, 1, key,adapter, values);
  const described = describeProviderSettings(db, 1, key,adapter);
  assert.deepEqual(described.map((field) => [field.name, field.value, field.set]), [
    ["host", "host.example.invalid", undefined], ["mode", "a", undefined], ["token", undefined, true], ["pem", undefined, true],
  ]);
  const dump = text(described);
  assert.ok(!dump.includes(values.token) && !dump.includes(values.pem));
});

test("an empty secret or file value keeps the stored one", (t) => {
  const { db } = setup(t);
  const adapter = fixture();
  setProviderSettings(db, 1, key,adapter, values);
  setProviderSettings(db, 1, key,adapter, { host: "other.example.invalid", token: "", pem: "" });
  assert.deepEqual(providerSettings(db, 1, key,"fixture"), { ...values, host: "other.example.invalid" });
});

test("unknown fields, bad choices and missing required fields are rejected", (t) => {
  const { db, rows } = setup(t);
  const adapter = fixture();
  assert.throws(() => setProviderSettings(db, 1, key,adapter, { ...values, extra: "x" }), /Unknown setting/);
  assert.throws(() => setProviderSettings(db, 1, key,adapter, { ...values, mode: "c" }), /choices/);
  assert.throws(() => setProviderSettings(db, 1, key,adapter, { host: "h" }), /required/);
  assert.throws(() => setProviderSettings(db, 1, key,adapter, { ...values, host: 5 }), /text/);
  assert.throws(() => setProviderSettings(db, 1, key,adapter, { ...values, pem: "x".repeat(20_001) }), /too long/);
  assert.deepEqual(providerSettings(db, 1, key,"fixture"), {});
  assert.equal(rows("SELECT * FROM events WHERE type = 'provider.settings_changed'").length, 0);
});

test("stored provider settings do not contain plaintext", (t) => {
  const { db, one } = setup(t);
  setProviderSettings(db, 1, key,fixture(), values);
  const stored = one("SELECT settings_encrypted FROM user_providers WHERE user_id = ? AND provider = 'fixture'", 1).settings_encrypted;
  for (const value of [values.host, values.token, values.pem]) assert.ok(!stored.includes(value));
  assert.deepEqual(JSON.parse(decrypt(key, "provider-settings", stored)), values);
});

test("the settings event lists field names only and enabling a provider is recorded", (t) => {
  const { db, rows } = setup(t);
  setProviderSettings(db, 1, key,fixture(), values);
  const [event] = rows("SELECT severity, actor, detail FROM events WHERE type = 'provider.settings_changed'");
  assert.deepEqual([event.severity, event.actor], ["info", "owner"]);
  assert.deepEqual(JSON.parse(event.detail).fields, ["host", "mode", "token", "pem"]);
  for (const value of [values.host, values.token, values.pem]) assert.ok(!event.detail.includes(value));
  setProviderEnabled(db, 1,"fixture", false);
  setProviderEnabled(db, 1,"fixture", true);
  assert.deepEqual(rows("SELECT type FROM events WHERE type LIKE 'provider.%abled' ORDER BY id").map((row) => row.type),
    ["provider.disabled", "provider.enabled"]);
  assert.throws(() => setProviderEnabled(db, 1,"nope", true), /Unknown provider/);
});

const EXPIRED = /This link attempt has expired\. Start again\./;

test("a connect state completes once issued", async (t) => {
  const { db } = setup(t);
  const adapter = fixture();
  const { start, state } = await beginConnection(db, 1, key,adapter, { now: T0 });
  assert.equal(start.kind, "form");
  const id = await completeConnection(db, 1, key,adapter, state, { any: 1 }, { now: later(0.005) });
  assert.ok(id > 0);
  const [begin, complete] = adapter.calls;
  assert.ok(typeof begin.ctx.nonce === "string" && begin.ctx.nonce.length > 0);
  assert.equal(complete.ctx.nonce, begin.ctx.nonce);
  assert.deepEqual(complete.payload, { any: 1 });
});

test("a tampered connect state is rejected", async (t) => {
  const { db } = setup(t);
  const adapter = fixture();
  const { state } = await beginConnection(db, 1, key,adapter, { now: T0 });
  const [body, signature] = state.split(".");
  const flip = (value) => (value[0] === "A" ? "B" : "A") + value.slice(1);
  for (const bad of [flip(body) + "." + signature, body + "." + flip(signature), body, "", "x.y.z"]) {
    await assert.rejects(completeConnection(db, 1, key,adapter, bad, {}, { now: T0 }), EXPIRED);
  }
  assert.equal(adapter.calls.filter((call) => call.step === "complete").length, 0);
});

test("an expired connect state is rejected", async (t) => {
  const { db } = setup(t);
  const adapter = fixture();
  const { state } = await beginConnection(db, 1, key,adapter, { now: T0 });
  await assert.rejects(completeConnection(db, 1, key,adapter, state, {}, { now: new Date(T0.getTime() + 30 * 60_000 + 1) }), EXPIRED);
});

test("a connect state issued for another provider is rejected", async (t) => {
  const { db } = setup(t);
  const { state } = await beginConnection(db, 1, key,fixture("fixture"), { now: T0 });
  await assert.rejects(completeConnection(db, 1, key,fixture("fixture-b"), state, {}, { now: T0 }), EXPIRED);
});

test("connecting creates a disabled connection holding the adapter credential", async (t) => {
  const { db, one } = setup(t);
  const adapter = fixture();
  const { state } = await beginConnection(db, 1, key,adapter, { now: T0 });
  const id = await completeConnection(db, 1, key,adapter, state, {}, { now: T0 });
  const row = one("SELECT provider, label, enabled, status, credential_encrypted FROM connections WHERE id = ?", id);
  assert.deepEqual([row.provider, row.label, row.enabled, row.status], ["fixture", "Fixture Bank", 0, "active"]);
  assert.equal(decrypt(key, "connection-credential", row.credential_encrypted), "cred-2");
  assert.equal(adapter.calls[0].existing, undefined);
  assert.equal(adapter.calls[1].existing, undefined);
  setProviderEnabled(db, 1,"fixture", false);
  await assert.rejects(beginConnection(db, 1, key,adapter, { now: T0 }), /disabled/);
});

test("repairing a connection replaces its credential in place and passes the old one", async (t) => {
  const { db, one, rows } = setup(t);
  const adapter = fixture();
  const id = createConnection(db, 1, key,{ provider: "fixture", label: "Old", credential: "old-credential" });
  db.prepare("UPDATE connections SET status = 'needs_reauth', last_error = 'bad' WHERE id = ?").run(id);
  const { state } = await beginConnection(db, 1, key,adapter, { connectionId: id, now: T0 });
  const repaired = await completeConnection(db, 1, key,adapter, state, {}, { now: T0 });
  assert.equal(repaired, id);
  assert.equal(adapter.calls[0].existing, "old-credential");
  assert.equal(adapter.calls[1].existing, "old-credential");
  const row = one("SELECT status, last_error, credential_encrypted FROM connections WHERE id = ?", id);
  assert.deepEqual([row.status, row.last_error], ["active", null]);
  assert.equal(decrypt(key, "connection-credential", row.credential_encrypted), "cred-2");
  assert.equal(rows("SELECT id FROM connections").length, 1);
});

test("disconnecting calls the adapter and deletes the connection", async (t) => {
  const { db, rows } = setup(t);
  const adapter = fixture();
  const id = createConnection(db, 1, key,{ provider: "fixture", label: "Fixture", credential: "to-disconnect" });
  await disconnectAndDelete(db, 1, key,adapter, id);
  assert.deepEqual(adapter.disconnected, ["to-disconnect"]);
  assert.equal(rows("SELECT id FROM connections").length, 0);
  assert.equal(rows("SELECT * FROM events WHERE type = 'connection.deleted'").length, 1);
  assert.equal(rows("SELECT * FROM events WHERE type = 'connection.disconnect_failed'").length, 0);
});

test("a failing disconnect still deletes the connection and records a warning", async (t) => {
  const { db, rows } = setup(t);
  const adapter = fixture("fixture", { async disconnect() { throw new Error("boom credential-xyz"); } });
  const id = createConnection(db, 1, key,{ provider: "fixture", label: "Fixture", credential: "credential-xyz" });
  await disconnectAndDelete(db, 1, key,adapter, id);
  assert.equal(rows("SELECT id FROM connections").length, 0);
  const events = rows("SELECT severity, detail FROM events WHERE type = 'connection.disconnect_failed'");
  assert.equal(events.length, 1);
  assert.equal(events[0].severity, "warning");
  assert.ok(!text(rows("SELECT * FROM events")).includes("credential-xyz"));
});

function engine(t, adapter = fixture()) {
  const env = setup(t);
  const id = createConnection(env.db, 1, key,{ provider: "fixture", label: "Fixture", credential: "tok" });
  setConnectionEnabled(env.db, 1, id,true);
  const sync = (now = T0, options = {}) => syncConnection(env.db, key, id, adapter, { now, ...options });
  return { ...env, id, adapter, sync };
}
const txn = (extra = {}) => ({ externalId: "t1", date: "2026-11-08", description: "AMZN MKTP", amountCents: -2500, kind: "expense", pending: false, ...extra });
const account = (transactions) => ({ externalId: "a1", name: "Checking", kind: "bank", currency: "USD", balanceCents: 100, transactions });

test("the engine stores counterparty and category, refreshes them and leaves user fields alone", async (t) => {
  const { db, adapter, sync, one } = engine(t);
  adapter.accounts = [account([txn({ counterparty: "Amazon", category: "shopping" })])];
  const first = await sync();
  assert.equal(first.added, 1);
  assert.deepEqual(one("SELECT counterparty, provider_category FROM transactions"), { counterparty: "Amazon", provider_category: "shopping" });
  db.exec("INSERT INTO categories (id, user_id, name) VALUES (1, 1, 'Shopping')");
  db.exec("UPDATE transactions SET category_id = 1, reviewed = 1, memo = 'mine'");
  adapter.accounts = [account([txn({ counterparty: "Amazon Marketplace", category: "retail" })])];
  const second = await sync(later(1));
  assert.deepEqual([second.added, second.updated], [0, 1]);
  assert.deepEqual(one("SELECT counterparty, provider_category, category_id, reviewed, memo FROM transactions"),
    { counterparty: "Amazon Marketplace", provider_category: "retail", category_id: 1, reviewed: 1, memo: "mine" });
  const third = await sync(later(2));
  assert.equal(third.updated, 0);
});

test("the engine uses the adapter transport and passes decrypted provider settings", async (t) => {
  const transport = () => () => "transport";
  const seen = [];
  const adapter = fixture("fixture", { transport(settings) { seen.push(settings); return transport; } });
  const { db, sync } = engine(t, adapter);
  setProviderSettings(db, 1, key,adapter, values);
  adapter.accounts = [];
  await sync();
  const ctx = adapter.calls.find((call) => call.step === "fetch").ctx;
  assert.equal(ctx.request, transport);
  assert.deepEqual(ctx.settings, values);
  assert.deepEqual(seen, [values]);
  assert.equal(ctx.now.toISOString(), T0.toISOString());
  const injected = () => {};
  await sync(later(1), { request: injected });
  assert.equal(adapter.calls.filter((call) => call.step === "fetch")[1].ctx.request, injected);
});

test("undecryptable provider settings fail the run", async (t) => {
  const { db, sync, one } = engine(t);
  db.exec("INSERT INTO user_providers (user_id, provider, settings_encrypted, sync_interval_minutes) VALUES (1, 'fixture', 'v1.bad.bad.bad', 360)");
  await assert.rejects(sync(), /Could not decrypt/);
  assert.equal(one("SELECT status FROM sync_runs").status, "failed");
});

async function demoConnection(db, name, scenario = "healthy") {
  const { state } = await beginConnection(db, 1, key,demo, { now: T0 });
  const id = await completeConnection(db, 1, key,demo, state, { name, scenario }, { now: T0 });
  setConnectionEnabled(db, 1, id,true);
  return id;
}
const demoSync = (db, id, now = T0) => syncConnection(db, key, id, demo, { now });

test("demo pending rows post later under the same id", async (t) => {
  const { db, rows } = setup(t);
  const id = await demoConnection(db, "Alpha Bank");
  await demoSync(db, id);
  const pending = rows("SELECT id, external_id FROM transactions WHERE pending = 1 AND external_id NOT LIKE '%hold:%'");
  assert.ok(pending.length > 0);
  await demoSync(db, id, later(3));
  for (const row of pending) {
    const now = rows("SELECT id, pending, removed_at FROM transactions WHERE id = ?", row.id);
    assert.deepEqual(now, [{ id: row.id, pending: 0, removed_at: null }]);
  }
});

test("the demo same-day hold is soft-removed by the next day's sync", async (t) => {
  const { db, rows } = setup(t);
  const id = await demoConnection(db, "Alpha Bank");
  await demoSync(db, id);
  const hold = () => rows("SELECT pending, removed_at FROM transactions WHERE external_id LIKE '%hold:2026-11-10'");
  assert.deepEqual(hold(), [{ pending: 1, removed_at: null }]);
  const next = await demoSync(db, id, later(1));
  assert.ok(next.removed >= 1);
  assert.notEqual(hold()[0].removed_at, null);
});

test("a demo card payment appears on both sides with opposite signs as transfers", async (t) => {
  const { db, rows } = setup(t);
  const id = await demoConnection(db, "Alpha Bank");
  await demoSync(db, id);
  const sides = rows(`SELECT a.kind AS account, t.amount_cents, t.kind FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE t.date = '2026-10-10' AND t.external_id LIKE '%cardpay%' ORDER BY a.kind`);
  assert.equal(sides.length, 2);
  assert.deepEqual(sides.map((side) => [side.account, side.kind]), [["bank", "transfer"], ["credit_card", "transfer"]]);
  assert.ok(sides[0].amount_cents < 0 && sides[1].amount_cents === -sides[0].amount_cents);
});

test("a demo reauth scenario leaves the connection needing re-authorization", async (t) => {
  const { db, one } = setup(t);
  const id = await demoConnection(db, "Alpha Bank", "reauth");
  await assert.rejects(demoSync(db, id), { kind: "auth" });
  assert.equal(one("SELECT status FROM connections WHERE id = ?", id).status, "needs_reauth");
});

test("a demo outage scenario leaves the connection in error", async (t) => {
  const { db, one } = setup(t);
  const id = await demoConnection(db, "Alpha Bank", "outage");
  await assert.rejects(demoSync(db, id), { kind: "unavailable" });
  assert.equal(one("SELECT status FROM connections WHERE id = ?", id).status, "error");
});

test("demo connections with different names do not share ids", async (t) => {
  const { db, rows } = setup(t);
  const a = await demoConnection(db, "Alpha Bank");
  const b = await demoConnection(db, "Beta Bank");
  await demoSync(db, a);
  await demoSync(db, b);
  const ids = (sql) => new Set(rows(sql).map((row) => row.external_id));
  const accounts = ids("SELECT external_id FROM accounts");
  const transactions = ids("SELECT external_id FROM transactions");
  assert.equal(accounts.size, 8);
  assert.equal(transactions.size, rows("SELECT id FROM transactions").length);
});

test("repairing a demo connection under a new name keeps its ids", async (t) => {
  const { db, rows, one } = setup(t);
  const id = await demoConnection(db, "Alpha Bank");
  await demoSync(db, id);
  const snapshot = () => ({
    accounts: rows("SELECT external_id FROM accounts ORDER BY id").map((row) => row.external_id),
    transactions: rows("SELECT external_id FROM transactions ORDER BY id").map((row) => row.external_id),
  });
  const before = snapshot();
  const { state } = await beginConnection(db, 1, key,demo, { connectionId: id, now: T0 });
  await completeConnection(db, 1, key,demo, state, { name: "Alpha Renamed", scenario: "healthy" }, { now: T0 });
  const again = await demoSync(db, id);
  assert.equal(again.added, 0);
  assert.deepEqual(snapshot(), before);
  assert.equal(one("SELECT institution FROM accounts WHERE kind = 'loan'").institution, "Alpha Renamed");
});

checkAdapter(test, assert, { adapter: demo, settings: {}, request: fetch, payload: { name: "Contract Bank", scenario: "healthy" }, now: T0 });

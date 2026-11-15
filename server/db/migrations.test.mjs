import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { initialize, migrations } from "./migrations.ts";

function connect(db) {
  db.exec("INSERT INTO providers (key, name, default_sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES ('fixture', 'Fixture', 360, 15, 10)");
  return Number(db.prepare("INSERT INTO connections (user_id, provider, label) VALUES (1, 'fixture', 'Fixture') RETURNING id").get().id);
}

test("a fresh database reaches the latest version with its seeded user, providers and jobs", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, migrations.length);
  assert.deepEqual(db.prepare("SELECT id, currency, username, password_hash FROM users").all().map((row) => ({ ...row })),
    [{ id: 1, currency: "USD", username: null, password_hash: null }]);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'settings'").get(), undefined);
  assert.deepEqual(db.prepare("SELECT key FROM providers ORDER BY key").all().map((row) => row.key), ["demo", "plaid", "simplefin"]);
  assert.deepEqual({ ...db.prepare("SELECT name, default_sync_interval_minutes, min_sync_interval_minutes, lookback_days FROM providers WHERE key = 'plaid'").get() },
    { name: "Plaid", default_sync_interval_minutes: 360, min_sync_interval_minutes: 60, lookback_days: 14 });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_providers").get().n, 3);
  assert.equal(db.prepare("SELECT schedule FROM jobs WHERE key = 'sync-connections'").get().schedule, "*/5 * * * *");
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});

test("upgrading a version 7 database preserves ids and links provider accounts", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const migration of migrations.slice(0, 7)) db.exec(migration.sql);
  db.exec("PRAGMA user_version = 7");
  db.exec(`
    INSERT INTO accounts (id, name, kind, balance_cents) VALUES (3, 'Manual checking', 'bank', 1000);
    INSERT INTO accounts (id, name, kind, balance_cents, provider, external_id)
      VALUES (7, 'Sandbox card', 'credit_card', 5000, 'legacy:sandbox', 'acc_1');
    INSERT INTO accounts (id, name, kind, balance_cents, provider, external_id)
      VALUES (8, 'Savings', 'bank', 8000, 'simplefin:main', 'sf_1');
    INSERT INTO categories (id, name) VALUES (1, 'Groceries');
    INSERT INTO transactions (id, date, merchant, account_id, amount_cents, category_id, kind, reviewed, external_id, memo) VALUES
      (10, '2026-11-01', 'Market', 3, -900, 1, 'expense', 1, NULL, 'Weekly shop'),
      (11, '2026-11-02', 'Payroll', 3, 5000, NULL, 'income', 0, NULL, NULL),
      (12, '2026-11-03', 'Cafe', 7, -400, 1, 'expense', 1, 'txn_1', NULL);
  `);
  initialize(db);
  const rows = (sql) => db.prepare(sql).all().map((row) => ({ ...row }));
  assert.deepEqual(rows("SELECT id FROM accounts ORDER BY id").map((row) => row.id), [3, 7, 8]);
  assert.deepEqual(rows("SELECT id FROM transactions ORDER BY id").map((row) => row.id), [10, 11, 12]);
  assert.deepEqual(rows("SELECT provider, label, enabled, status, credential_encrypted FROM connections"), [
    { provider: "simplefin", label: "simplefin:main", enabled: 0, status: "needs_reauth", credential_encrypted: null },
  ]);
  const card = db.prepare("SELECT class, external_id, balance_cents, connection_id FROM accounts WHERE id = 7").get();
  assert.deepEqual({ ...card }, { class: "liability", external_id: "acc_1", balance_cents: 5000, connection_id: null });
  const savings = db.prepare("SELECT class, external_id, balance_cents, connection_id FROM accounts WHERE id = 8").get();
  assert.deepEqual({ ...savings }, { class: "asset", external_id: "sf_1", balance_cents: 8000, connection_id: 1 });
  const manual = db.prepare("SELECT class, connection_id FROM accounts WHERE id = 3").get();
  assert.deepEqual({ ...manual }, { class: "asset", connection_id: null });
  assert.deepEqual(rows("SELECT id, category_id, reviewed, external_id, memo FROM transactions WHERE id IN (10, 12) ORDER BY id"), [
    { id: 10, category_id: 1, reviewed: 1, external_id: null, memo: "Weekly shop" },
    { id: 12, category_id: 1, reviewed: 1, external_id: "txn_1", memo: null },
  ]);
  const added = db.prepare("INSERT INTO accounts (user_id, name, kind, class) VALUES (1, 'New', 'bank', 'asset') RETURNING id").get();
  assert.ok(Number(added.id) > 7);
  assert.deepEqual(rows("PRAGMA foreign_key_check"), []);
});

test("foreign keys are enforced after initialize", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  assert.throws(() => db.exec(
    "INSERT INTO transactions (date, merchant, account_id, amount_cents, kind) VALUES ('2026-11-01', 'Orphan', 999, 100, 'income')"
  ), /FOREIGN KEY/);
});

test("initialize on an up-to-date database changes nothing", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec("UPDATE users SET currency = 'EUR'");
  const schema = () => db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all().map((row) => ({ ...row }));
  const before = schema();
  initialize(db);
  assert.deepEqual(schema(), before);
  assert.equal(db.prepare("SELECT currency FROM users").get().currency, "EUR");
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, migrations.length);
  assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
});

test("deleting a connection keeps its accounts and transactions", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  const connectionId = connect(db);
  db.prepare("INSERT INTO accounts (id, user_id, name, kind, class, connection_id, external_id) VALUES (1, 1, 'Checking', 'bank', 'asset', ?, 'a')").run(connectionId);
  db.exec("INSERT INTO transactions (date, merchant, account_id, amount_cents, kind) VALUES ('2026-11-01', 'Payroll', 1, 100, 'income')");
  db.prepare("DELETE FROM connections WHERE id = ?").run(connectionId);
  assert.equal(db.prepare("SELECT connection_id FROM accounts WHERE id = 1").get().connection_id, null);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 1);
});

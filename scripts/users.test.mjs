import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { insertCategory } from "../server/budget/mutations.ts";
import { createConnection, setConnectionEnabled } from "../server/connections/mutations.ts";
import { initialize, migrations } from "../server/db/migrations.ts";
import { recordEvent } from "../server/events.ts";
import { demo } from "../server/imports/demo.ts";
import { setProviderEnabled, setProviderSettings } from "../server/imports/provider-settings.ts";
import { syncConnection } from "../server/imports/sync.ts";
import { decrypt, encrypt } from "../server/secrets.ts";
import { saveReview } from "../server/transactions/mutations.ts";
import {
  authenticate, claimFirstUser, createUser, deleteUser, hashPassword, listUsers, needsSetup, setPassword, userById, verifyPassword,
} from "../server/users/users.ts";

const key = randomBytes(32);
const T0 = new Date("2026-11-10T12:00:00.000Z");
const NOT_ADMIN = /^Error: Only an administrator can manage users$/;
const PASSWORD = "correct horse battery";

const open = (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  return db;
};
const rows = (db, sql, ...args) => db.prepare(sql).all(...args).map((row) => ({ ...row }));
const count = (db, sql, ...args) => Number(db.prepare(sql).get(...args).n);

function populatedVersion8(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  for (const migration of migrations.slice(0, 8)) db.exec(migration.sql);
  db.exec("PRAGMA user_version = 8");
  const settings = encrypt(key, "provider-settings", JSON.stringify({ clientId: "cid_1", secret: "sec_1" }));
  const credential = encrypt(key, "connection-credential", "access-token-1");
  db.prepare("UPDATE providers SET settings_encrypted = ?, sync_interval_minutes = 90, enabled = 0 WHERE key = 'plaid'").run(settings);
  db.exec(`
    UPDATE settings SET password_hash = 'old-hash', session_version = 4, currency = 'EUR';
    UPDATE users SET primary_color = '#112233';
    INSERT INTO connections (id, provider, label, status, enabled, credential_encrypted, last_synced_at, last_error)
      VALUES (4, 'plaid', 'First Bank', 'error', 1, '${credential}', '2026-11-01T00:00:00.000Z', 'boom');
    INSERT INTO accounts (id, name, kind, class, currency, balance_cents, connection_id, external_id, institution, last_four) VALUES
      (3, 'Checking', 'bank', 'asset', 'EUR', 5000, 4, 'ext-1', 'First Bank', '1234'),
      (8, 'Manual', 'other', 'asset', 'USD', NULL, NULL, NULL, NULL, NULL);
    INSERT INTO categories (id, name) VALUES (2, 'Groceries'), (5, 'Dining'), (9, 'Temporary');
    DELETE FROM categories WHERE id = 9;
    INSERT INTO budget_months (month, expected_income_cents) VALUES ('2026-10', 100000), ('2026-11', 680000);
    INSERT INTO budget_limits (month, category_id, limit_cents) VALUES ('2026-11', 2, 65000), ('2026-11', 5, 30000), ('2026-10', 2, 1000);
    INSERT INTO sync_runs (id, connection_id, status) VALUES (6, 4, 'ok');
    INSERT INTO transactions (id, date, merchant, account_id, amount_cents, category_id, kind, reviewed, memo, external_id, first_seen_sync_run_id) VALUES
      (11, '2026-11-02', 'Market', 3, -900, 2, 'expense', 1, 'Weekly shop', 'tx-1', 6),
      (12, '2026-11-03', 'Payroll', 8, 5000, NULL, 'income', 0, NULL, NULL, NULL);
    INSERT INTO events (id, severity, type, actor, connection_id, sync_run_id, message) VALUES
      (7, 'error', 'sync.failed', 'scheduler', 4, 6, 'Sync failed'), (8, 'info', 'connection.created', 'owner', NULL, NULL, 'Created');
    INSERT INTO notification_targets (id, name, type, config) VALUES (3, 'Hook', 'webhook', '{}');
    INSERT INTO notification_matcher_targets (matcher_id, target_id) VALUES (1, 3);
    INSERT INTO notification_deliveries (id, event_id, target_id) VALUES (1, 7, 3);
  `);
  return db;
}

test("migration 9 moves a populated version 8 database to per-user ownership without losing rows", (t) => {
  const db = populatedVersion8(t);
  const ids = (table, column = "id") => rows(db, `SELECT ${column} AS id FROM ${table} ORDER BY ${column}`).map((row) => row.id);
  const owned = ["connections", "accounts", "categories", "events", "notification_targets", "notification_matchers"];
  const before = Object.fromEntries(owned.concat("transactions", "sync_runs").map((table) => [table, ids(table)]));
  const limits = rows(db, "SELECT month, category_id, limit_cents FROM budget_limits ORDER BY month, category_id");
  const months = rows(db, "SELECT month, expected_income_cents FROM budget_months ORDER BY month");
  const transactions = rows(db, "SELECT id, category_id, reviewed, memo, account_id, first_seen_sync_run_id FROM transactions ORDER BY id");
  initialize(db);

  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 9);
  for (const [table, expected] of Object.entries(before)) assert.deepEqual(ids(table), expected, table);
  assert.deepEqual(rows(db, "SELECT month, category_id, limit_cents FROM budget_limits ORDER BY month, category_id"), limits);
  assert.deepEqual(rows(db, "SELECT month, expected_income_cents FROM budget_months ORDER BY month"), months);
  assert.deepEqual(rows(db, "SELECT id, category_id, reviewed, memo, account_id, first_seen_sync_run_id FROM transactions ORDER BY id"), transactions);
  for (const table of [...owned, "budget_months", "budget_limits"]) {
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE user_id != 1`), 0, table);
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM ${table} WHERE user_id IS NULL`), 0, table);
  }
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM budget_limits"), 3);

  const [user] = rows(db, "SELECT id, username, password_hash, session_version, role, currency, primary_color FROM users");
  assert.deepEqual(user, { id: 1, username: null, password_hash: "old-hash", session_version: 4, role: "admin", currency: "EUR", primary_color: "#112233" });
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'settings'").get(), undefined);
  assert.deepEqual(rows(db, "PRAGMA table_info(providers)").map((column) => column.name),
    ["key", "name", "default_sync_interval_minutes", "min_sync_interval_minutes", "lookback_days"]);
  assert.deepEqual(rows(db, "SELECT key, default_sync_interval_minutes AS d FROM providers ORDER BY key"),
    [{ key: "demo", d: 60 }, { key: "plaid", d: 360 }, { key: "simplefin", d: 720 }]);

  const providers = rows(db, "SELECT user_id, provider, enabled, settings_encrypted, sync_interval_minutes FROM user_providers ORDER BY provider");
  assert.deepEqual(providers.map((row) => [row.user_id, row.provider, row.enabled, row.sync_interval_minutes]),
    [[1, "demo", 1, 60], [1, "plaid", 0, 90], [1, "simplefin", 1, 720]]);
  assert.deepEqual(JSON.parse(decrypt(key, "provider-settings", providers[1].settings_encrypted)), { clientId: "cid_1", secret: "sec_1" });
  assert.equal(providers[0].settings_encrypted, null);

  const stored = db.prepare("SELECT credential_encrypted FROM connections WHERE id = 4").get().credential_encrypted;
  assert.equal(decrypt(key, "connection-credential", stored), "access-token-1");
  assert.deepEqual(rows(db, "PRAGMA foreign_key_check"), []);
  assert.equal(db.prepare("INSERT INTO categories (user_id, name) VALUES (1, 'Next') RETURNING id").get().id, 10);
  assert.equal(db.prepare("INSERT INTO events (severity, type, actor, message) VALUES ('info', 'x', 'system', 'm') RETURNING user_id").get().user_id, null);

  const fresh = open(t);
  assert.equal(fresh.prepare("PRAGMA user_version").get().user_version, 9);
  assert.deepEqual(rows(fresh, "PRAGMA foreign_key_check"), []);
});

test("passwords hash with scrypt and verify only against a well-formed matching hash", () => {
  const hash = hashPassword(PASSWORD);
  assert.match(hash, /^scrypt\$15\$8\$1\$[A-Za-z0-9+/]+=*\$[A-Za-z0-9+/]+=*$/);
  assert.equal(Buffer.from(hash.split("$")[4], "base64").length, 16);
  assert.equal(Buffer.from(hash.split("$")[5], "base64").length, 32);
  assert.notEqual(hash, hashPassword(PASSWORD));
  assert.equal(verifyPassword(PASSWORD, hash), true);
  assert.equal(verifyPassword(PASSWORD + "x", hash), false);
  for (const bad of ["", "x", "scrypt", "scrypt$15$8$1$abc", "scrypt$15$8$1$$", "scrypt$99$8$1$AAAA$AAAA", "scrypt$x$8$1$AAAA$AAAA",
    "md5$15$8$1$AAAA$AAAA", hash + "$extra", null, undefined, 5]) {
    assert.equal(verifyPassword(PASSWORD, bad), false, String(bad));
  }
});

test("usernames and passwords are validated, unique without regard to case, and setup happens once", (t) => {
  const db = open(t);
  assert.equal(needsSetup(db), true);
  for (const username of ["ab", "x".repeat(33), "has space", "bad!name", "", "  a  "]) {
    assert.throws(() => claimFirstUser(db, { username, password: PASSWORD }), /Username/, username);
  }
  for (const password of ["short", "x".repeat(9), "x".repeat(201), ""]) {
    assert.throws(() => claimFirstUser(db, { username: "alice", password }), /Password must be 10 to 200 characters/);
  }
  assert.equal(needsSetup(db), true);
  const id = claimFirstUser(db, { username: "  Alice.Smith_1-x  ", password: PASSWORD });
  assert.equal(id, 1);
  assert.equal(needsSetup(db), false);
  assert.deepEqual(rows(db, "SELECT username, role FROM users"), [{ username: "Alice.Smith_1-x", role: "admin" }]);
  assert.throws(() => claimFirstUser(db, { username: "other", password: PASSWORD }), /already/);
  assert.throws(() => createUser(db, id, { username: "ALICE.smith_1-X", password: PASSWORD }), /already taken/);
  const second = createUser(db, id, { username: "bobby", password: PASSWORD });
  assert.deepEqual(userById(db, second), { id: second, username: "bobby", role: "member", currency: "USD", primary_color: null, session_version: 1 });
  assert.equal(userById(db, 999), undefined);
  assert.throws(() => createUser(db, id, { username: "carol", password: PASSWORD, role: "root" }), /Role/);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM users"), 2);
  const event = rows(db, "SELECT severity, actor, user_id FROM events WHERE type = 'user.setup'");
  assert.deepEqual(event, [{ severity: "info", actor: "owner", user_id: id }]);
});

test("a claim on an empty users table creates the administrator and its default matcher", (t) => {
  const db = open(t);
  db.exec("DELETE FROM notification_matchers; DELETE FROM user_providers; DELETE FROM users");
  const id = claimFirstUser(db, { username: "alice", password: PASSWORD });
  assert.deepEqual(rows(db, "SELECT role FROM users WHERE id = ?", id), [{ role: "admin" }]);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM notification_matchers WHERE user_id = ? AND name = 'default'", id), 1);
});

test("authenticate gives the same answer for an unknown user and a wrong password, and setPassword rotates the session", (t) => {
  const db = open(t);
  const admin = claimFirstUser(db, { username: "alice", password: PASSWORD });
  assert.deepEqual(authenticate(db, "ALICE", PASSWORD), { id: admin, role: "admin", session_version: 1 });
  assert.equal(authenticate(db, "nobody", PASSWORD), null);
  assert.equal(authenticate(db, "alice", "wrong password!"), null);
  assert.equal(authenticate(db, "alice", ""), null);
  db.exec("INSERT INTO users (username, role) VALUES ('unclaimed', 'member')");
  assert.equal(authenticate(db, "unclaimed", PASSWORD), null);

  assert.throws(() => setPassword(db, admin, "wrong password!", "a brand new password"), /current password/);
  assert.throws(() => setPassword(db, admin, PASSWORD, "short"), /Password must be/);
  assert.equal(userById(db, admin).session_version, 1);
  assert.equal(setPassword(db, admin, PASSWORD, "a brand new password"), 2);
  assert.equal(userById(db, admin).session_version, 2);
  assert.equal(authenticate(db, "alice", PASSWORD), null);
  assert.deepEqual(authenticate(db, "alice", "a brand new password"), { id: admin, role: "admin", session_version: 2 });
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM events WHERE type = 'user.password_changed' AND user_id = ?", admin), 1);
});

test("only administrators manage users, and an administrator cannot remove themselves or the last administrator", (t) => {
  const db = open(t);
  const admin = claimFirstUser(db, { username: "alice", password: PASSWORD });
  const member = createUser(db, admin, { username: "bobby", password: PASSWORD });
  assert.throws(() => createUser(db, member, { username: "carol", password: PASSWORD }), NOT_ADMIN);
  assert.throws(() => listUsers(db, member), NOT_ADMIN);
  assert.throws(() => deleteUser(db, member, admin), NOT_ADMIN);
  assert.throws(() => deleteUser(db, member, member), NOT_ADMIN);
  assert.throws(() => listUsers(db, 999), NOT_ADMIN);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM users"), 2);

  assert.deepEqual(listUsers(db, admin).map((user) => Object.keys(user).sort()), [["created_at", "id", "role", "username"], ["created_at", "id", "role", "username"]]);
  assert.deepEqual(listUsers(db, admin).map((user) => [user.id, user.username, user.role]), [[admin, "alice", "admin"], [member, "bobby", "member"]]);
  assert.throws(() => deleteUser(db, admin, admin), /cannot delete your own/);
  assert.throws(() => deleteUser(db, admin, 999), /User not found/);
  const second = createUser(db, admin, { username: "carol", password: PASSWORD, role: "admin" });
  deleteUser(db, admin, second);
  assert.equal(userById(db, second), undefined);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"), 1);
  assert.deepEqual(rows(db, "SELECT type, user_id, detail FROM events WHERE type IN ('user.created', 'user.deleted') ORDER BY id").map((event) => [event.type, event.user_id, JSON.parse(event.detail).username]),
    [["user.created", admin, "bobby"], ["user.created", admin, "carol"], ["user.deleted", admin, "carol"]]);
});

const OWNED = {
  user_providers: "SELECT COUNT(*) AS n FROM user_providers WHERE user_id = ?",
  connections: "SELECT COUNT(*) AS n FROM connections WHERE user_id = ?",
  accounts: "SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?",
  transactions: "SELECT COUNT(*) AS n FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)",
  balance_snapshots: "SELECT COUNT(*) AS n FROM balance_snapshots WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)",
  sync_runs: "SELECT COUNT(*) AS n FROM sync_runs WHERE connection_id IN (SELECT id FROM connections WHERE user_id = ?)",
  categories: "SELECT COUNT(*) AS n FROM categories WHERE user_id = ?",
  budget_months: "SELECT COUNT(*) AS n FROM budget_months WHERE user_id = ?",
  budget_limits: "SELECT COUNT(*) AS n FROM budget_limits WHERE user_id = ?",
  events: "SELECT COUNT(*) AS n FROM events WHERE user_id = ?",
  notification_targets: "SELECT COUNT(*) AS n FROM notification_targets WHERE user_id = ?",
  notification_matchers: "SELECT COUNT(*) AS n FROM notification_matchers WHERE user_id = ?",
  notification_matcher_targets: "SELECT COUNT(*) AS n FROM notification_matcher_targets WHERE matcher_id IN (SELECT id FROM notification_matchers WHERE user_id = ?)",
  notification_deliveries: "SELECT COUNT(*) AS n FROM notification_deliveries WHERE target_id IN (SELECT id FROM notification_targets WHERE user_id = ?)",
};
const counts = (db, id) => Object.fromEntries(Object.entries(OWNED).map(([table, sql]) => [table, count(db, sql, id)]));

async function seedUser(db, id, tag) {
  const credential = JSON.stringify({ name: tag + " Bank", scenario: "healthy", seed: tag.repeat(8) });
  const connection = createConnection(db, id, key, { provider: "demo", label: tag + " Bank", credential });
  setConnectionEnabled(db, id, connection, true);
  setProviderEnabled(db, id, "plaid", false);
  setProviderSettings(db, id, key, { key: "demo", settings: [] }, {});
  await syncConnection(db, key, connection, demo, { now: T0 });
  insertCategory(db, id, tag + " Food", "2026-11", 5000);
  const category = Number(db.prepare("SELECT id FROM categories WHERE user_id = ?").get(id).id);
  const transaction = Number(db.prepare("SELECT t.id FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = ? AND t.kind = 'expense' ORDER BY t.id LIMIT 1").get(id).id);
  assert.equal(saveReview(db, id, transaction, { categoryId: category }), true);
  const event = recordEvent(db, { severity: "warning", type: "test.event", actor: "system", userId: id, message: "Test" });
  const target = Number(db.prepare("INSERT INTO notification_targets (user_id, name, type, config) VALUES (?, 'Hook', 'webhook', '{}') RETURNING id").get(id).id);
  const matcher = Number(db.prepare("INSERT INTO notification_matchers (user_id, name, match_severity) VALUES (?, 'Mine', '[\"error\"]') RETURNING id").get(id).id);
  db.prepare("INSERT INTO notification_matcher_targets (matcher_id, target_id) VALUES (?, ?)").run(matcher, target);
  db.prepare("INSERT INTO notification_deliveries (event_id, target_id) VALUES (?, ?)").run(event, target);
}

test("deleting a user removes everything they owned and leaves the other user untouched", async (t) => {
  const db = open(t);
  const admin = claimFirstUser(db, { username: "alice", password: PASSWORD });
  const member = createUser(db, admin, { username: "bobby", password: PASSWORD });
  await seedUser(db, admin, "A");
  await seedUser(db, member, "B");
  const mine = counts(db, member);
  for (const table of Object.keys(OWNED)) assert.ok(mine[table] > 0, table + " should be seeded");
  const beforeTotals = counts(db, admin);
  const beforeOthers = JSON.stringify([
    rows(db, "SELECT * FROM accounts WHERE user_id = ? ORDER BY id", admin), rows(db, "SELECT * FROM connections WHERE user_id = ? ORDER BY id", admin),
    rows(db, "SELECT * FROM categories WHERE user_id = ? ORDER BY id", admin), rows(db, "SELECT * FROM events WHERE user_id = ? ORDER BY id", admin),
    rows(db, "SELECT * FROM user_providers WHERE user_id = ? ORDER BY provider", admin),
    rows(db, "SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = ? ORDER BY t.id", admin),
  ]);

  deleteUser(db, admin, member);

  assert.equal(userById(db, member), undefined);
  assert.deepEqual(counts(db, member), Object.fromEntries(Object.keys(OWNED).map((table) => [table, 0])));
  assert.deepEqual({ ...counts(db, admin), events: 0 }, { ...beforeTotals, events: 0 });
  assert.equal(counts(db, admin).events, beforeTotals.events + 1);
  assert.equal(JSON.stringify([
    rows(db, "SELECT * FROM accounts WHERE user_id = ? ORDER BY id", admin), rows(db, "SELECT * FROM connections WHERE user_id = ? ORDER BY id", admin),
    rows(db, "SELECT * FROM categories WHERE user_id = ? ORDER BY id", admin), rows(db, "SELECT * FROM events WHERE user_id = ? AND type != 'user.deleted' ORDER BY id", admin),
    rows(db, "SELECT * FROM user_providers WHERE user_id = ? ORDER BY provider", admin),
    rows(db, "SELECT t.* FROM transactions t JOIN accounts a ON a.id = t.account_id WHERE a.user_id = ? ORDER BY t.id", admin),
  ]), beforeOthers);
  for (const table of ["transactions", "balance_snapshots", "sync_runs", "notification_matcher_targets", "notification_deliveries", "accounts", "connections"]) {
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM ${table}`), counts(db, admin)[table], table);
  }
  assert.deepEqual(rows(db, "PRAGMA foreign_key_check"), []);
});

test("no password or password hash is ever stored in an event", async (t) => {
  const db = open(t);
  const first = "first secret passphrase", second = "second secret passphrase", third = "third secret passphrase";
  const admin = claimFirstUser(db, { username: "alice", password: first });
  const member = createUser(db, admin, { username: "bobby", password: second });
  assert.equal(authenticate(db, "bobby", "wrong wrong wrong"), null);
  assert.equal(authenticate(db, "ghost", first), null);
  setPassword(db, member, second, third);
  assert.throws(() => setPassword(db, member, "not the password", "another secret passphrase"));
  const hashes = rows(db, "SELECT password_hash FROM users").map((row) => row.password_hash);
  const secrets = [first, second, third, "another secret passphrase", "wrong wrong wrong", "scrypt$", ...hashes];
  const clean = () => {
    const dump = JSON.stringify(rows(db, "SELECT * FROM events"));
    for (const secret of secrets) assert.ok(!dump.includes(secret), secret);
  };
  clean();
  assert.deepEqual(rows(db, "SELECT type FROM events ORDER BY id").map((row) => row.type), ["user.setup", "user.created", "user.password_changed"]);
  deleteUser(db, admin, member);
  clean();
  assert.deepEqual(rows(db, "SELECT type FROM events ORDER BY id").map((row) => row.type), ["user.setup", "user.created", "user.deleted"]);
});

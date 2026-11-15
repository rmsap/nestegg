import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { connectionAccounts, connectionList, providerList, readouts, recentEvents, recentRuns } from "./queries.ts";
import { connectionStatus, needsKeys, providerStatus } from "./status.ts";
import { initialize } from "../db/migrations.ts";

function setup(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`INSERT INTO providers (key, name, default_sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES
    ('fixture', 'Fixture', 360, 15, 10), ('fixture-b', 'Fixture B', 120, 5, 10);
    INSERT INTO connections (id, user_id, provider, label, enabled) VALUES (1, 1, 'fixture', 'One', 1), (2, 1, 'fixture', 'Two', 0), (3, 1, 'fixture-b', 'Three', 0);`);
  return db;
}

test("provider rows report whether settings are saved", (t) => {
  const db = setup(t);
  db.exec("INSERT INTO user_providers (user_id, provider, settings_encrypted, sync_interval_minutes) VALUES (1, 'fixture', 'v1.x.y.z', 360)");
  const rows = providerList(db, 1);
  const fixture = rows.find((row) => row.key === "fixture");
  assert.deepEqual(fixture, { key: "fixture", name: "Fixture", enabled: 1, sync_interval_minutes: 360, min_sync_interval_minutes: 15, configured: true });
  assert.equal(rows.find((row) => row.key === "fixture-b").configured, false);
  assert.equal(Object.getPrototypeOf(fixture), Object.prototype);
});

test("connections are ordered by provider then id and count their accounts", (t) => {
  const db = setup(t);
  db.exec(`INSERT INTO accounts (user_id, name, kind, class, connection_id, external_id) VALUES
    (1, 'A', 'bank', 'asset', 1, 'a'), (1, 'B', 'bank', 'asset', 1, 'b'), (1, 'C', 'bank', 'asset', 3, 'c');`);
  const rows = connectionList(db, 1);
  assert.deepEqual(rows.map((row) => [row.id, row.accounts]), [[1, 2], [2, 0], [3, 1]]);
  assert.deepEqual(rows[0], { id: 1, provider: "fixture", label: "One", status: "active", enabled: 1, last_synced_at: null, last_error: null, accounts: 2 });
});

test("recent runs are newest first, limited, and derive their trigger", (t) => {
  const db = setup(t);
  db.exec(`INSERT INTO job_runs (id, job_key, trigger, started_at) VALUES (1, 'sync-connections', 'schedule', '2026-11-01T00:00:00.000Z');
    INSERT INTO sync_runs (connection_id, job_run_id, started_at, status) VALUES
      (1, 1, '2026-11-01T00:00:00.000Z', 'ok'), (1, NULL, '2026-11-02T00:00:00.000Z', 'failed'),
      (1, NULL, '2026-11-03T00:00:00.000Z', 'ok'), (2, NULL, '2026-11-04T00:00:00.000Z', 'ok');`);
  const rows = recentRuns(db, 1, 1);
  assert.deepEqual(rows.map((row) => [row.started_at.slice(0, 10), row.trigger]),
    [["2026-11-03", "manual"], ["2026-11-02", "manual"], ["2026-11-01", "schedule"]]);
  assert.equal(recentRuns(db, 1, 1, 2).length, 2);
  assert.equal(recentRuns(db, 1, 99).length, 0);
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
});

test("recent events are newest first and show no label for a deleted connection", (t) => {
  const db = setup(t);
  db.exec(`INSERT INTO events (at, severity, type, actor, user_id, connection_id, message) VALUES
    ('2026-11-01T00:00:00.000Z', 'info', 'a', 'owner', 1, 1, 'First'),
    ('2026-11-02T00:00:00.000Z', 'warning', 'b', 'owner', 1, 2, 'Second'),
    ('2026-11-03T00:00:00.000Z', 'info', 'c', 'system', 1, NULL, 'Third');
    DELETE FROM connections WHERE id = 2;`);
  const rows = recentEvents(db, 1);
  assert.deepEqual(rows.map((row) => [row.message, row.connection]), [["Third", null], ["Second", null], ["First", "One"]]);
  assert.equal(recentEvents(db, 1, 1).length, 1);
});

test("connection accounts are grouped by connection and leave out closed and unlinked accounts", (t) => {
  const db = setup(t);
  db.exec(`INSERT INTO accounts (user_id, name, kind, class, connection_id, external_id, last_four, balance_cents, closed_at) VALUES
    (1, 'Savings', 'bank', 'asset', 1, 'a', '1234', 5000, NULL), (1, 'Card', 'credit_card', 'liability', 1, 'b', NULL, NULL, NULL),
    (1, 'Old', 'bank', 'asset', 1, 'c', NULL, 0, '2026-01-01'), (1, 'Other', 'loan', 'liability', 3, 'd', '9', 100, NULL);
    INSERT INTO accounts (user_id, name, kind, class) VALUES (1, 'Manual', 'bank', 'asset');`);
  const grouped = connectionAccounts(db, 1);
  assert.deepEqual([...grouped.keys()], [1, 3]);
  assert.deepEqual(grouped.get(1), [
    { name: "Card", kind: "credit_card", last_four: null, balance_cents: null },
    { name: "Savings", kind: "bank", last_four: "1234", balance_cents: 5000 },
  ]);
  assert.equal(grouped.has(2), false);
  assert.equal(Object.getPrototypeOf(grouped.get(3)[0]), Object.prototype);
});

test("readouts count on connections, open linked accounts, the latest sync and failures", (t) => {
  const db = setup(t);
  assert.deepEqual(readouts(db, 1), { connections: 1, accounts: 0, lastSyncedAt: null, needAttention: 0 });
  db.exec(`UPDATE connections SET last_synced_at = '2026-11-02T00:00:00.000Z' WHERE id = 1;
    UPDATE connections SET last_synced_at = '2026-11-03T00:00:00.000Z', status = 'error' WHERE id = 2;
    UPDATE connections SET enabled = 1, status = 'needs_reauth' WHERE id = 3;
    INSERT INTO accounts (user_id, name, kind, class, connection_id, external_id, closed_at) VALUES
      (1, 'A', 'bank', 'asset', 1, 'a', NULL), (1, 'B', 'bank', 'asset', 3, 'b', NULL), (1, 'C', 'bank', 'asset', 3, 'c', '2026-01-01');
    INSERT INTO accounts (user_id, name, kind, class) VALUES (1, 'Manual', 'bank', 'asset');`);
  assert.deepEqual(readouts(db, 1), { connections: 2, accounts: 2, lastSyncedAt: "2026-11-03T00:00:00.000Z", needAttention: 1 });
});

test("connection and provider statuses follow the vocabulary", () => {
  const row = (enabled, status, last_synced_at) => ({ enabled, status, last_synced_at });
  const synced = "2026-11-01T00:00:00.000Z";
  assert.deepEqual([row(0, "error", synced), row(1, "active", null), row(1, "active", synced), row(1, "needs_reauth", synced), row(1, "error", null)]
    .map(connectionStatus), ["Off", "Ready", "Synced", "Failed", "Failed"]);
  const on = { enabled: 1 };
  assert.equal(providerStatus({ enabled: 0 }, true, [row(1, "error", null)]), "Off");
  assert.equal(providerStatus(on, true, [row(1, "active", synced)]), "Needs keys");
  assert.equal(providerStatus(on, false, []), "Ready");
  assert.equal(providerStatus(on, false, [row(1, "active", null), row(0, "error", null)]), "Ready");
  assert.equal(providerStatus(on, false, [row(1, "active", null), row(1, "active", synced)]), "Synced");
  assert.equal(providerStatus(on, false, [row(1, "active", synced), row(1, "error", synced)]), "Failed");
  const required = { settings: [{ name: "k", label: "K", kind: "text", required: true }] };
  assert.equal(needsKeys(required, { configured: false }), true);
  assert.equal(needsKeys(required, { configured: true }), false);
  assert.equal(needsKeys({ settings: [] }, { configured: false }), false);
});

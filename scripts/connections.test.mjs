import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { connectionList, providerList, recentEvents, recentRuns } from "../server/connections/queries.ts";
import { initialize } from "../server/db/migrations.ts";

function setup(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`INSERT INTO providers (key, name, sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES
    ('fixture', 'Fixture', 360, 15, 10), ('fixture-b', 'Fixture B', 120, 5, 10);
    INSERT INTO connections (id, provider, label, enabled) VALUES (1, 'fixture', 'One', 1), (2, 'fixture', 'Two', 0), (3, 'fixture-b', 'Three', 0);`);
  return db;
}

test("provider rows report whether settings are saved", (t) => {
  const db = setup(t);
  db.exec("UPDATE providers SET settings_encrypted = 'v1.x.y.z' WHERE key = 'fixture'");
  const rows = providerList(db);
  const fixture = rows.find((row) => row.key === "fixture");
  assert.deepEqual(fixture, { key: "fixture", name: "Fixture", enabled: 1, sync_interval_minutes: 360, min_sync_interval_minutes: 15, configured: true });
  assert.equal(rows.find((row) => row.key === "fixture-b").configured, false);
  assert.equal(Object.getPrototypeOf(fixture), Object.prototype);
});

test("connections are ordered by provider then id and count their accounts", (t) => {
  const db = setup(t);
  db.exec(`INSERT INTO accounts (name, kind, class, connection_id, external_id) VALUES
    ('A', 'bank', 'asset', 1, 'a'), ('B', 'bank', 'asset', 1, 'b'), ('C', 'bank', 'asset', 3, 'c');`);
  const rows = connectionList(db);
  assert.deepEqual(rows.map((row) => [row.id, row.accounts]), [[1, 2], [2, 0], [3, 1]]);
  assert.deepEqual(rows[0], { id: 1, provider: "fixture", label: "One", status: "active", enabled: 1, last_synced_at: null, last_error: null, accounts: 2 });
});

test("recent runs are newest first, limited, and derive their trigger", (t) => {
  const db = setup(t);
  db.exec(`INSERT INTO job_runs (id, job_key, trigger, started_at) VALUES (1, 'sync-connections', 'schedule', '2026-11-01T00:00:00.000Z');
    INSERT INTO sync_runs (connection_id, job_run_id, started_at, status) VALUES
      (1, 1, '2026-11-01T00:00:00.000Z', 'ok'), (1, NULL, '2026-11-02T00:00:00.000Z', 'failed'),
      (1, NULL, '2026-11-03T00:00:00.000Z', 'ok'), (2, NULL, '2026-11-04T00:00:00.000Z', 'ok');`);
  const rows = recentRuns(db, 1);
  assert.deepEqual(rows.map((row) => [row.started_at.slice(0, 10), row.trigger]),
    [["2026-11-03", "manual"], ["2026-11-02", "manual"], ["2026-11-01", "schedule"]]);
  assert.equal(recentRuns(db, 1, 2).length, 2);
  assert.equal(recentRuns(db, 99).length, 0);
  assert.equal(Object.getPrototypeOf(rows[0]), Object.prototype);
});

test("recent events are newest first and show no label for a deleted connection", (t) => {
  const db = setup(t);
  db.exec(`INSERT INTO events (at, severity, type, actor, connection_id, message) VALUES
    ('2026-11-01T00:00:00.000Z', 'info', 'a', 'owner', 1, 'First'),
    ('2026-11-02T00:00:00.000Z', 'warning', 'b', 'owner', 2, 'Second'),
    ('2026-11-03T00:00:00.000Z', 'info', 'c', 'system', NULL, 'Third');
    DELETE FROM connections WHERE id = 2;`);
  const rows = recentEvents(db);
  assert.deepEqual(rows.map((row) => [row.message, row.connection]), [["Third", null], ["Second", null], ["First", "One"]]);
  assert.equal(recentEvents(db, 1).length, 1);
});

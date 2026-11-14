import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createConnection, setConnectionEnabled, setSyncInterval } from "../server/connections/mutations.ts";
import { initialize } from "../server/db/migrations.ts";
import { nextRun } from "../server/schedule/cron.ts";
import { runDueJobs, runJob, setJobSchedule } from "../server/schedule/jobs.ts";
import { syncDueConnections } from "../server/schedule/sync-job.ts";

const key = randomBytes(32);
const T0 = new Date("2026-11-10T12:00:00.000Z");
const minutes = (n, base = T0) => new Date(base.getTime() + n * 60_000);
const local = (...parts) => new Date(...parts);
const iso = (date) => date.toISOString();

function setup(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`INSERT INTO providers (key, name, sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES
    ('fixture', 'Fixture', 360, 15, 10), ('fixture-b', 'Fixture B', 360, 15, 10)`);
  const rows = (sql, ...args) => db.prepare(sql).all(...args).map((row) => ({ ...row }));
  const one = (sql, ...args) => ({ ...db.prepare(sql).get(...args) });
  return { db, rows, one };
}

function adapterFor(provider) {
  const adapter = {
    key: provider, settings: [], calls: 0, error: null,
    async fetchAccounts() {
      adapter.calls++;
      if (adapter.error) throw adapter.error;
      return [];
    },
  };
  return adapter;
}

function connect(db, provider = "fixture", enable = true) {
  const id = createConnection(db, key, { provider, label: provider + id_(), credential: "tok_" + provider });
  if (enable) setConnectionEnabled(db, id, true);
  return id;
}
let counter = 0;
const id_ = () => ++counter;

const sync = (db, adapters, now) => {
  const jobRunId = Number(db.prepare("INSERT INTO job_runs (job_key, trigger) VALUES ('sync-connections', 'schedule') RETURNING id").get().id);
  return syncDueConnections(db, key, new Map(adapters.map((a) => [a.key, a])), { jobRunId, trigger: "schedule", now });
};

const ok = { "sync-connections": async () => {} };

test("nextRun finds the next matching minute", () => {
  assert.deepEqual(nextRun("*/5 * * * *", local(2026, 10, 10, 8, 2, 30)), local(2026, 10, 10, 8, 5));
  assert.deepEqual(nextRun("*/5 * * * *", local(2026, 10, 10, 8, 5, 0)), local(2026, 10, 10, 8, 10));
  assert.deepEqual(nextRun("0 7 * * *", local(2026, 10, 10, 7, 0, 1)), local(2026, 10, 11, 7, 0));
  assert.deepEqual(nextRun("0 7 * * *", local(2026, 10, 10, 6, 0)), local(2026, 10, 10, 7, 0));
  assert.deepEqual(nextRun("0 0 1 * *", local(2026, 10, 30, 12)), local(2026, 11, 1, 0, 0));
  assert.deepEqual(nextRun("0 9 * * 1-5", local(2026, 10, 13, 18)), local(2026, 10, 16, 9, 0));
  assert.deepEqual(nextRun("0 0 13 * 5", local(2026, 10, 10, 12)), local(2026, 10, 13, 0, 0));
  assert.deepEqual(nextRun("0 0 13 * 5", local(2026, 10, 13, 12)), local(2026, 10, 20, 0, 0));
  assert.deepEqual(nextRun("0 0 13 * 5", local(2026, 10, 20, 12)), local(2026, 10, 27, 0, 0));
  assert.deepEqual(nextRun("0 0 * * 7", local(2026, 10, 10, 12)), local(2026, 10, 15, 0, 0));
  assert.deepEqual(nextRun("5,20 8-10/2 * * *", local(2026, 10, 10, 8, 5)), local(2026, 10, 10, 8, 20));
  assert.deepEqual(nextRun("5,20 8-10/2 * * *", local(2026, 10, 10, 8, 20)), local(2026, 10, 10, 10, 5));
  assert.deepEqual(nextRun("5,20 8-10/2 * * *", local(2026, 10, 10, 10, 20)), local(2026, 10, 11, 8, 5));
});

test("invalid expressions throw", () => {
  for (const bad of ["* * * *", "* * * * * *", "", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8",
    "*/0 * * * *", "abc * * * *", "5-1 * * * *", "1/5 * * * *", "1,,2 * * * *", "-1 * * * *", "0 0 31 2 *"]) {
    assert.throws(() => nextRun(bad, T0), /^Error: Invalid schedule$/, bad);
  }
});

test("a due job runs once and schedules its next run", async (t) => {
  const { db, rows, one } = setup(t);
  assert.deepEqual(await runDueJobs(db, ok, T0), ["sync-connections"]);
  const run = one("SELECT status, trigger, error FROM job_runs");
  assert.deepEqual(run, { status: "ok", trigger: "schedule", error: null });
  const job = one("SELECT locked_until, last_run_at, next_run_at FROM jobs");
  assert.equal(job.locked_until, null);
  assert.equal(job.last_run_at, iso(T0));
  assert.ok(job.next_run_at > iso(T0));
  assert.deepEqual(await runDueJobs(db, ok, T0), []);
  assert.equal(rows("SELECT id FROM job_runs").length, 1);
});

test("an unexpired lease blocks a run and an expired one does not", async (t) => {
  const { db, rows } = setup(t);
  db.prepare("UPDATE jobs SET locked_until = ?").run(iso(minutes(5)));
  assert.deepEqual(await runDueJobs(db, ok, T0), []);
  assert.equal(await runJob(db, ok, "sync-connections", "manual", T0), null);
  assert.equal(rows("SELECT id FROM job_runs").length, 0);
  assert.deepEqual(await runDueJobs(db, ok, minutes(6)), ["sync-connections"]);
  assert.equal(rows("SELECT id FROM job_runs").length, 1);
});

test("a throwing handler fails the run without throwing", async (t) => {
  const { db, one } = setup(t);
  const handlers = { "sync-connections": async () => { throw new Error("boom"); } };
  const result = await runJob(db, handlers, "sync-connections", "schedule", T0);
  assert.equal(result.status, "failed");
  assert.deepEqual(one("SELECT status, error FROM job_runs"), { status: "failed", error: "boom" });
  const event = one("SELECT severity, actor, job_run_id, detail FROM events WHERE type = 'job.failed'");
  assert.deepEqual([event.severity, event.actor, event.job_run_id], ["error", "scheduler", result.jobRunId]);
  assert.ok(event.detail.includes("sync-connections"));
  const job = one("SELECT locked_until, next_run_at FROM jobs");
  assert.equal(job.locked_until, null);
  assert.ok(job.next_run_at > iso(T0));
  assert.equal((await runJob(db, {}, "sync-connections", "manual", minutes(1))).status, "failed");
  assert.equal(one("SELECT error FROM job_runs ORDER BY id DESC").error, "No handler for this job");
});

test("an invalid stored schedule disables the job", async (t) => {
  const { db, one } = setup(t);
  db.prepare("UPDATE jobs SET schedule = 'nonsense'").run();
  const result = await runJob(db, ok, "sync-connections", "schedule", T0);
  assert.equal(result.status, "ok");
  assert.deepEqual(one("SELECT enabled, next_run_at FROM jobs"), { enabled: 0, next_run_at: null });
  assert.equal(one("SELECT severity FROM events WHERE type = 'job.invalid_schedule'").severity, "error");
  assert.deepEqual(await runDueJobs(db, ok, minutes(60)), []);
  assert.equal(one("SELECT COUNT(*) AS n FROM job_runs").n, 1);
});

test("a disabled job is skipped but runs manually", async (t) => {
  const { db, one } = setup(t);
  db.prepare("UPDATE jobs SET enabled = 0").run();
  assert.deepEqual(await runDueJobs(db, ok, T0), []);
  assert.equal(await runJob(db, ok, "sync-connections", "schedule", T0), null);
  assert.equal((await runJob(db, ok, "sync-connections", "manual", T0)).status, "ok");
  assert.equal(one("SELECT trigger FROM job_runs").trigger, "manual");
  await assert.rejects(runJob(db, ok, "missing", "manual", T0), /Unknown job/);
});

test("setJobSchedule rejects an invalid expression", (t) => {
  const { db, one } = setup(t);
  const before = one("SELECT schedule FROM jobs").schedule;
  assert.throws(() => setJobSchedule(db, "sync-connections", "61 * * * *"), /Invalid schedule/);
  assert.equal(one("SELECT schedule FROM jobs").schedule, before);
  setJobSchedule(db, "sync-connections", "0 * * * *", T0);
  assert.equal(one("SELECT schedule FROM jobs").schedule, "0 * * * *");
  assert.equal(one("SELECT COUNT(*) AS n FROM events WHERE type = 'job.schedule_changed'").n, 1);
});

test("a connection is due when never synced and again after the provider interval", async (t) => {
  const { db, rows } = setup(t);
  const fixture = adapterFor("fixture");
  connect(db);
  assert.deepEqual(await sync(db, [fixture], T0), { synced: 1, failed: 0 });
  assert.deepEqual(await sync(db, [fixture], minutes(359)), { synced: 0, failed: 0 });
  assert.deepEqual(await sync(db, [fixture], minutes(360)), { synced: 1, failed: 0 });
  assert.equal(rows("SELECT id FROM sync_runs").length, 2);
  setSyncInterval(db, "fixture", 15);
  assert.deepEqual(await sync(db, [fixture], minutes(374)), { synced: 0, failed: 0 });
  assert.deepEqual(await sync(db, [fixture], minutes(375)), { synced: 1, failed: 0 });
});

test("a failed attempt is not retried before the interval elapses", async (t) => {
  const { db, rows } = setup(t);
  const fixture = adapterFor("fixture");
  fixture.error = new Error("down");
  connect(db);
  assert.deepEqual(await sync(db, [fixture], T0), { synced: 0, failed: 1 });
  assert.deepEqual(await sync(db, [fixture], minutes(30)), { synced: 0, failed: 0 });
  assert.equal(fixture.calls, 1);
  assert.deepEqual(await sync(db, [fixture], minutes(360)), { synced: 0, failed: 1 });
  assert.equal(rows("SELECT id FROM sync_runs").length, 2);
});

test("ineligible connections are skipped without a sync run", async (t) => {
  const { db, rows } = setup(t);
  const fixture = adapterFor("fixture"), fixtureB = adapterFor("fixture-b");
  const disabled = connect(db, "fixture", false);
  const reauth = connect(db);
  db.prepare("UPDATE connections SET status = 'needs_reauth' WHERE id = ?").run(reauth);
  const offProvider = connect(db, "fixture-b");
  db.prepare("UPDATE providers SET enabled = 0 WHERE key = 'fixture-b'").run();
  const noAdapter = connect(db, "fixture");
  assert.deepEqual(await sync(db, [], T0), { synced: 0, failed: 0 });
  assert.deepEqual(await sync(db, [fixture, fixtureB], T0), { synced: 1, failed: 0 });
  assert.deepEqual(rows("SELECT connection_id FROM sync_runs"), [{ connection_id: noAdapter }]);
  assert.ok(![disabled, reauth, offProvider].includes(noAdapter));
});

test("one failing connection does not stop the next", async (t) => {
  const { db, rows } = setup(t);
  const fixture = adapterFor("fixture"), fixtureB = adapterFor("fixture-b");
  connect(db, "fixture");
  connect(db, "fixture-b");
  fixture.error = new Error("down");
  assert.deepEqual(await sync(db, [fixture, fixtureB], T0), { synced: 1, failed: 1 });
  const jobRunId = Number(db.prepare("SELECT id FROM job_runs").get().id);
  db.exec("PRAGMA foreign_keys = OFF");
  assert.deepEqual(rows("SELECT status, job_run_id FROM sync_runs ORDER BY id"), [
    { status: "failed", job_run_id: jobRunId }, { status: "ok", job_run_id: jobRunId },
  ]);
});

test("the scheduled sync job records linked runs and events", async (t) => {
  const { db, one } = setup(t);
  const fixture = adapterFor("fixture");
  connect(db);
  const adapters = new Map([["fixture", fixture]]);
  const handlers = { "sync-connections": (context) => syncDueConnections(db, key, adapters, context).then(() => undefined) };
  assert.deepEqual(await runDueJobs(db, handlers, T0), ["sync-connections"]);
  const run = one("SELECT id, status FROM job_runs");
  assert.equal(run.status, "ok");
  assert.deepEqual(one("SELECT status, job_run_id FROM sync_runs"), { status: "ok", job_run_id: run.id });
  assert.equal(one("SELECT actor FROM events WHERE type = 'sync.completed'").actor, "scheduler");
});

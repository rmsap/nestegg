import type { DatabaseSync } from "node:sqlite";
import { recordEvent } from "../events.ts";
import { nextRun, validSchedule } from "./cron.ts";

export type JobHandler = (context: { db: DatabaseSync; jobRunId: number; trigger: "schedule" | "manual"; now: Date }) => Promise<void>;
type Trigger = "schedule" | "manual";

const LEASE = 10 * 60_000;

function claim(db: DatabaseSync, key: string, trigger: Trigger, now: Date) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = db.prepare("SELECT enabled FROM jobs WHERE key = ?").get(key);
    if (!job) throw new Error("Unknown job");
    let jobRunId: number | null = null;
    if (trigger !== "schedule" || job.enabled) {
      const at = now.toISOString();
      const claimed = db.prepare("UPDATE jobs SET locked_until = ? WHERE key = ? AND (locked_until IS NULL OR locked_until < ?)")
        .run(new Date(now.getTime() + LEASE).toISOString(), key, at);
      if (claimed.changes) {
        db.prepare("UPDATE job_runs SET status = 'failed', finished_at = ?, error = 'Interrupted' WHERE job_key = ? AND status = 'running'")
          .run(at, key);
        jobRunId = Number(db.prepare("INSERT INTO job_runs (job_key, trigger, started_at) VALUES (?, ?, ?) RETURNING id").get(key, trigger, at)?.id);
      }
    }
    db.exec("COMMIT");
    return jobRunId;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function finish(db: DatabaseSync, key: string, trigger: Trigger, jobRunId: number, error: string | null, now: Date) {
  const actor = trigger === "schedule" ? "scheduler" : "owner";
  db.exec("BEGIN IMMEDIATE");
  try {
    const at = now.toISOString();
    const job = db.prepare("SELECT schedule FROM jobs WHERE key = ?").get(key);
    let next: string | null = null;
    let badSchedule = !job;
    if (job) {
      try {
        next = nextRun(String(job.schedule), now).toISOString();
      } catch {
        badSchedule = true;
      }
    }
    db.prepare("UPDATE job_runs SET status = ?, finished_at = ?, error = ? WHERE id = ?")
      .run(error === null ? "ok" : "failed", at, error, jobRunId);
    db.prepare("UPDATE jobs SET last_run_at = ?, locked_until = NULL, next_run_at = ?, enabled = CASE WHEN ? THEN 0 ELSE enabled END WHERE key = ?")
      .run(at, next, Number(badSchedule), key);
    if (error !== null) {
      recordEvent(db, { severity: "error", type: "job.failed", actor, jobRunId, message: "Job failed", detail: { job: key, error } });
    }
    if (badSchedule) {
      recordEvent(db, { severity: "error", type: "job.invalid_schedule", actor, jobRunId, message: "Job disabled because its schedule is invalid", detail: { job: key } });
    }
    db.exec("COMMIT");
  } catch (failure) {
    db.exec("ROLLBACK");
    throw failure;
  }
}

export async function runJob(db: DatabaseSync, handlers: Record<string, JobHandler>, key: string, trigger: Trigger, now = new Date()) {
  const jobRunId = claim(db, key, trigger, now);
  if (jobRunId === null) return null;
  let error: string | null = null;
  const handler = Object.hasOwn(handlers, key) ? handlers[key] : undefined;
  if (!handler) error = "No handler for this job";
  else {
    try {
      await handler({ db, jobRunId, trigger, now });
    } catch (failure) {
      error = (failure instanceof Error ? failure.message : "Job failed").slice(0, 300);
    }
  }
  finish(db, key, trigger, jobRunId, error, now);
  return { jobRunId, status: error === null ? "ok" as const : "failed" as const };
}

export async function runDueJobs(db: DatabaseSync, handlers: Record<string, JobHandler>, now = new Date()) {
  const due = db.prepare("SELECT key FROM jobs WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?) ORDER BY key")
    .all(now.toISOString()).map((row) => String(row.key));
  const ran: string[] = [];
  for (const key of due) {
    if (await runJob(db, handlers, key, "schedule", now)) ran.push(key);
  }
  return ran;
}

function inTransaction(db: DatabaseSync, work: () => void) {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setJobSchedule(db: DatabaseSync, key: string, expression: string, now = new Date()) {
  if (!validSchedule(expression)) throw new Error("Invalid schedule");
  inTransaction(db, () => {
    if (!db.prepare("SELECT 1 FROM jobs WHERE key = ?").get(key)) throw new Error("Unknown job");
    db.prepare("UPDATE jobs SET schedule = ?, next_run_at = ? WHERE key = ?").run(expression, nextRun(expression, now).toISOString(), key);
    recordEvent(db, { severity: "info", type: "job.schedule_changed", actor: "owner", message: "Job schedule changed", detail: { job: key, schedule: expression } });
  });
}

export function setJobEnabled(db: DatabaseSync, key: string, enabled: boolean, now = new Date()) {
  inTransaction(db, () => {
    const job = db.prepare("SELECT schedule FROM jobs WHERE key = ?").get(key);
    if (!job) throw new Error("Unknown job");
    const next = enabled ? nextRun(String(job.schedule), now).toISOString() : null;
    db.prepare("UPDATE jobs SET enabled = ?, next_run_at = ? WHERE key = ?").run(Number(enabled), next, key);
    recordEvent(db, { severity: "info", type: enabled ? "job.enabled" : "job.disabled", actor: "owner", message: enabled ? "Job enabled" : "Job disabled", detail: { job: key } });
  });
}

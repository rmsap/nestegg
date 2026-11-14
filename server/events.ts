import type { DatabaseSync } from "node:sqlite";

export type NewEvent = {
  severity: "info" | "notice" | "warning" | "error";
  type: string;
  actor: "owner" | "scheduler" | "system";
  message: string;
  connectionId?: number;
  syncRunId?: number;
  jobRunId?: number;
  detail?: unknown;
};

export function recordEvent(db: DatabaseSync, event: NewEvent) {
  return Number(db.prepare(`
    INSERT INTO events (severity, type, actor, connection_id, sync_run_id, job_run_id, message, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `).get(event.severity, event.type, event.actor, event.connectionId ?? null, event.syncRunId ?? null,
    event.jobRunId ?? null, event.message, event.detail === undefined ? null : JSON.stringify(event.detail))?.id);
}

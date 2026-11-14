import type { DatabaseSync } from "node:sqlite";

export type ProviderRow = {
  key: string; name: string; enabled: number; sync_interval_minutes: number;
  min_sync_interval_minutes: number; configured: boolean;
};
export type ConnectionRow = {
  id: number; provider: string; label: string; status: string; enabled: number;
  last_synced_at: string | null; last_error: string | null; accounts: number;
};
export type SyncRunRow = {
  started_at: string; finished_at: string | null; status: string; trigger: string;
  transactions_added: number; transactions_updated: number; transactions_removed: number; error: string | null;
};
export type EventRow = { at: string; severity: string; type: string; message: string; connection: string | null };

// SQLite rows have a null prototype. Client component props need plain objects.
export function providerList(db: DatabaseSync) {
  return db.prepare(`
    SELECT key, name, enabled, sync_interval_minutes, min_sync_interval_minutes,
      settings_encrypted IS NOT NULL AS configured
    FROM providers ORDER BY name
  `).all().map((row) => ({ ...row, configured: Boolean(row.configured) })) as ProviderRow[];
}

export function connectionList(db: DatabaseSync) {
  return db.prepare(`
    SELECT c.id, c.provider, c.label, c.status, c.enabled, c.last_synced_at, c.last_error,
      (SELECT COUNT(*) FROM accounts a WHERE a.connection_id = c.id) AS accounts
    FROM connections c ORDER BY c.provider, c.id
  `).all().map((row) => ({ ...row })) as ConnectionRow[];
}

export function recentRuns(db: DatabaseSync, connectionId: number, limit = 5) {
  return db.prepare(`
    SELECT s.started_at, s.finished_at, s.status, COALESCE(j.trigger, 'manual') AS trigger,
      s.transactions_added, s.transactions_updated, s.transactions_removed, s.error
    FROM sync_runs s LEFT JOIN job_runs j ON j.id = s.job_run_id
    WHERE s.connection_id = ? ORDER BY s.started_at DESC, s.id DESC LIMIT ?
  `).all(connectionId, limit).map((row) => ({ ...row })) as SyncRunRow[];
}

export function recentEvents(db: DatabaseSync, limit = 20) {
  return db.prepare(`
    SELECT e.at, e.severity, e.type, e.message, c.label AS connection
    FROM events e LEFT JOIN connections c ON c.id = e.connection_id
    ORDER BY e.at DESC, e.id DESC LIMIT ?
  `).all(limit).map((row) => ({ ...row })) as EventRow[];
}

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

export type LinkedAccount = { name: string; kind: string; last_four: string | null; balance_cents: number | null };

export function connectionAccounts(db: DatabaseSync) {
  const grouped = new Map<number, LinkedAccount[]>();
  const rows = db.prepare(`
    SELECT connection_id, name, kind, last_four, balance_cents FROM accounts
    WHERE connection_id IS NOT NULL AND closed_at IS NULL ORDER BY name, id
  `).all();
  for (const { connection_id, ...account } of rows) {
    const id = Number(connection_id);
    grouped.set(id, [...grouped.get(id) ?? [], account as LinkedAccount]);
  }
  return grouped;
}

export function readouts(db: DatabaseSync) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM connections WHERE enabled = 1) AS connections,
      (SELECT COUNT(*) FROM accounts WHERE connection_id IS NOT NULL AND closed_at IS NULL) AS accounts,
      (SELECT MAX(last_synced_at) FROM connections) AS last_synced_at,
      (SELECT COUNT(*) FROM connections WHERE enabled = 1 AND status != 'active') AS need_attention
  `).get();
  return {
    connections: Number(row?.connections), accounts: Number(row?.accounts),
    lastSyncedAt: row?.last_synced_at ? String(row.last_synced_at) : null, needAttention: Number(row?.need_attention),
  };
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

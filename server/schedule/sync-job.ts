import type { DatabaseSync } from "node:sqlite";
import { syncConnection } from "../imports/sync.ts";
import type { ProviderAdapter } from "../imports/transaction-provider.ts";

type Options = { jobRunId: number; trigger: "schedule" | "manual"; now: Date; request?: typeof fetch };

export async function syncDueConnections(db: DatabaseSync, key: Buffer, adapters: Map<string, ProviderAdapter>, options: Options) {
  const { jobRunId, trigger, now, request } = options;
  const rows = db.prepare(`
    SELECT c.id, c.provider, p.sync_interval_minutes AS interval,
      (SELECT MAX(s.started_at) FROM sync_runs s WHERE s.connection_id = c.id) AS last_started
    FROM connections c JOIN providers p ON p.key = c.provider
    WHERE c.enabled = 1 AND c.credential_encrypted IS NOT NULL AND p.enabled = 1 AND c.status != 'needs_reauth'
    ORDER BY c.id
  `).all();
  let synced = 0, failed = 0;
  for (const row of rows) {
    const adapter = adapters.get(String(row.provider));
    if (!adapter) continue;
    if (row.last_started !== null && Date.parse(String(row.last_started)) + Number(row.interval) * 60_000 > now.getTime()) continue;
    try {
      await syncConnection(db, key, Number(row.id), adapter, { trigger, jobRunId, now, request });
      synced++;
    } catch {
      failed++;
    }
  }
  return { synced, failed };
}

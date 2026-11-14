import type { DatabaseSync } from "node:sqlite";
import { recordEvent } from "../events.ts";
import { decrypt } from "../secrets.ts";
import { ProviderError } from "./transaction-provider.ts";
import type { ProviderAccount, ProviderAdapter } from "./transaction-provider.ts";

type Options = { trigger?: "schedule" | "manual"; jobRunId?: number; now?: Date; request?: typeof fetch };
type Window = { start: string; end: string };

const DAY = 86_400_000;
const STALE = 15 * 60_000;

class SyncError extends Error {}

const day = (date: Date) => date.toISOString().slice(0, 10);

function begin(db: DatabaseSync, connectionId: number, adapter: ProviderAdapter, jobRunId: number | null, now: Date) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare(`
      SELECT c.provider, c.enabled, c.credential_encrypted, c.last_synced_at, p.enabled AS provider_enabled, p.lookback_days
      FROM connections c JOIN providers p ON p.key = c.provider WHERE c.id = ?
    `).get(connectionId);
    if (!row) throw new SyncError("Unknown connection");
    if (!row.enabled) throw new SyncError("This connection is disabled");
    if (!row.credential_encrypted) throw new SyncError("This connection has no credential");
    if (!row.provider_enabled) throw new SyncError("This provider is disabled");
    if (adapter.key !== row.provider) throw new SyncError("The adapter does not match the connection provider");
    db.prepare("UPDATE sync_runs SET status = 'failed', finished_at = ?, error = 'Interrupted' WHERE connection_id = ? AND status = 'running' AND started_at < ?")
      .run(now.toISOString(), connectionId, new Date(now.getTime() - STALE).toISOString());
    if (db.prepare("SELECT 1 FROM sync_runs WHERE connection_id = ? AND status = 'running'").get(connectionId)) {
      throw new SyncError("A sync is already running for this connection");
    }
    const window = {
      start: day(new Date((row.last_synced_at ? Date.parse(String(row.last_synced_at)) - Number(row.lookback_days) * DAY : now.getTime() - 730 * DAY))),
      end: day(now),
    };
    const run = db.prepare(`
      INSERT INTO sync_runs (connection_id, job_run_id, started_at, window_start, window_end)
      VALUES (?, ?, ?, ?, ?) RETURNING id
    `).get(connectionId, jobRunId, now.toISOString(), window.start, window.end);
    db.exec("COMMIT");
    return { syncRunId: Number(run?.id), encrypted: String(row.credential_encrypted), window };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function apply(db: DatabaseSync, connectionId: number, syncRunId: number, accounts: ProviderAccount[], window: Window,
  actor: "owner" | "scheduler", now: Date) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!Array.isArray(accounts)) throw new SyncError("Invalid provider response");
    const at = now.toISOString();
    const today = day(now);
    const currency = String(db.prepare("SELECT currency FROM settings WHERE id = 1").get()?.currency);
    const upsertAccount = db.prepare(`
      INSERT INTO accounts (name, kind, class, currency, balance_cents, balance_as_of, connection_id, external_id, institution, last_four)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, external_id) DO UPDATE SET
        name = excluded.name, kind = excluded.kind, currency = excluded.currency,
        institution = excluded.institution, last_four = excluded.last_four,
        balance_cents = COALESCE(excluded.balance_cents, accounts.balance_cents),
        balance_as_of = COALESCE(excluded.balance_as_of, accounts.balance_as_of)
      RETURNING id
    `);
    const find = db.prepare("SELECT id, date, merchant, amount_cents, kind, pending, removed_at FROM transactions WHERE account_id = ? AND external_id = ?");
    const insert = db.prepare(`
      INSERT INTO transactions (date, merchant, account_id, amount_cents, kind, pending, external_id, first_seen_sync_run_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const update = db.prepare("UPDATE transactions SET date = ?, merchant = ?, amount_cents = ?, kind = ?, pending = ?, removed_at = NULL WHERE id = ?");
    const vanished = db.prepare(`
      SELECT id, external_id FROM transactions
      WHERE account_id = ? AND pending = 1 AND external_id IS NOT NULL AND removed_at IS NULL AND date BETWEEN ? AND ?
    `);
    const remove = db.prepare("UPDATE transactions SET removed_at = ? WHERE id = ?");
    const snapshot = db.prepare(`
      INSERT INTO balance_snapshots (account_id, date, balance_cents) VALUES (?, ?, ?)
      ON CONFLICT(account_id, date) DO UPDATE SET balance_cents = excluded.balance_cents
    `);
    let added = 0, updated = 0, removed = 0;
    for (const account of accounts) {
      if (!account.externalId || account.currency !== currency ||
        (account.balanceCents !== null && !Number.isSafeInteger(account.balanceCents))) {
        throw new SyncError("Invalid provider account or unsupported currency");
      }
      const accountId = Number(upsertAccount.get(account.name, account.kind,
        account.kind === "credit_card" || account.kind === "loan" ? "liability" : "asset", account.currency,
        account.balanceCents, account.balanceCents === null ? null : at, connectionId, account.externalId,
        account.institution ?? null, account.lastFour ?? null)?.id);
      if (account.balanceCents !== null) snapshot.run(accountId, today, account.balanceCents);
      const seen = new Set<string>();
      for (const entry of account.transactions) {
        const date = new Date(entry.date + "T00:00:00Z");
        if (!entry.externalId || !Number.isSafeInteger(entry.amountCents) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== entry.date) {
          throw new SyncError("Invalid provider transaction");
        }
        seen.add(entry.externalId);
        const pending = Number(entry.pending);
        const existing = find.get(accountId, entry.externalId);
        if (!existing) {
          insert.run(entry.date, entry.description, accountId, entry.amountCents, entry.kind, pending, entry.externalId, syncRunId);
          added++;
        } else if (existing.pending === 1 || pending === 0) {
          const changed = existing.date !== entry.date || existing.merchant !== entry.description ||
            existing.amount_cents !== entry.amountCents || existing.kind !== entry.kind || existing.pending !== pending;
          if (changed || existing.removed_at !== null) {
            update.run(entry.date, entry.description, entry.amountCents, entry.kind, pending, existing.id);
            updated++;
          }
        }
      }
      for (const row of vanished.all(accountId, window.start, window.end)) {
        if (seen.has(String(row.external_id))) continue;
        remove.run(at, row.id);
        removed++;
      }
    }
    db.prepare(`
      UPDATE connections SET last_synced_at = ?, status = 'active', last_error = NULL WHERE id = ?
    `).run(at, connectionId);
    db.prepare(`
      UPDATE sync_runs SET status = 'ok', finished_at = ?, accounts_seen = ?,
        transactions_added = ?, transactions_updated = ?, transactions_removed = ? WHERE id = ?
    `).run(at, accounts.length, added, updated, removed, syncRunId);
    recordEvent(db, {
      severity: "info", type: "sync.completed", actor, connectionId, syncRunId,
      message: "Sync completed", detail: { accounts: accounts.length, added, updated, removed },
    });
    db.exec("COMMIT");
    return { syncRunId, accounts: accounts.length, added, updated, removed };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function fail(db: DatabaseSync, connectionId: number, syncRunId: number, error: unknown, credential: string,
  actor: "owner" | "scheduler", now: Date) {
  const known = error instanceof ProviderError || error instanceof SyncError;
  const message = known ? (credential ? error.message.split(credential).join("[redacted]") : error.message) : "Sync failed";
  const auth = error instanceof ProviderError && error.kind === "auth";
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE sync_runs SET status = 'failed', finished_at = ?, error = ? WHERE id = ?")
      .run(now.toISOString(), message, syncRunId);
    db.prepare("UPDATE connections SET status = ?, last_error = ? WHERE id = ?")
      .run(auth ? "needs_reauth" : "error", message, connectionId);
    recordEvent(db, {
      severity: "error", type: auth ? "connection.needs_reauth" : "sync.failed", actor, connectionId, syncRunId,
      message: auth ? "Connection needs to be re-authorized" : "Sync failed", detail: { error: message },
    });
    db.exec("COMMIT");
  } catch (failure) {
    db.exec("ROLLBACK");
    throw failure;
  }
  return error instanceof ProviderError ? new ProviderError(error.kind, message) : new SyncError(message);
}

export async function syncConnection(db: DatabaseSync, key: Buffer, connectionId: number, adapter: ProviderAdapter, options: Options = {}) {
  const now = options.now ?? new Date();
  const actor = options.trigger === "schedule" ? "scheduler" : "owner";
  const { syncRunId, encrypted, window } = begin(db, connectionId, adapter, options.jobRunId ?? null, now);
  let credential = "";
  try {
    try {
      credential = decrypt(key, "connection-credential", encrypted);
    } catch {
      throw new SyncError("Could not decrypt stored secret");
    }
    // Complete network work before taking a write lock.
    const accounts = await adapter.fetchAccounts(credential, window, options.request);
    return apply(db, connectionId, syncRunId, accounts, window, actor, now);
  } catch (error) {
    throw fail(db, connectionId, syncRunId, error, credential, actor, now);
  }
}

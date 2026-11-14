import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { recordEvent } from "../events.ts";
import { providerSettings } from "../imports/provider-settings.ts";
import type { ConnectStart, ProviderAdapter, ProviderContext } from "../imports/transaction-provider.ts";
import { decrypt, encrypt, sign, verify } from "../secrets.ts";

type ConnectOptions = { connectionId?: number; now?: Date; request?: typeof fetch };

const STATE_TTL = 30 * 60_000;
const EXPIRED = "This link attempt has expired. Start again.";

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function connection(db: DatabaseSync, userId: number, id: number) {
  const row = db.prepare("SELECT label, enabled, credential_encrypted FROM connections WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) throw new Error("Connection not found");
  return row;
}

function secret(credential: string) {
  if (typeof credential !== "string" || !credential.trim()) throw new Error("A credential is required");
  return credential;
}

function providerOn(db: DatabaseSync, userId: number, providerKey: string) {
  const provider = db.prepare(`
    SELECT COALESCE(u.enabled, 1) AS enabled FROM providers p
    LEFT JOIN user_providers u ON u.provider = p.key AND u.user_id = ? WHERE p.key = ?
  `).get(userId, providerKey);
  if (!provider) throw new Error("Unknown provider");
  if (!provider.enabled) throw new Error("This provider is disabled");
}

export function createConnection(db: DatabaseSync, userId: number, key: Buffer, input: { provider: string; label: string; credential: string }) {
  return inTransaction(db, () => {
    providerOn(db, userId, input.provider);
    const label = String(input.label ?? "").trim();
    if (label.length < 1 || label.length > 80) throw new Error("Label must be 1 to 80 characters");
    const encrypted = encrypt(key, "connection-credential", secret(input.credential));
    const id = Number(db.prepare(
      "INSERT INTO connections (user_id, provider, label, enabled, status, credential_encrypted) VALUES (?, ?, ?, 0, 'active', ?) RETURNING id"
    ).get(userId, input.provider, label, encrypted)?.id);
    recordEvent(db, {
      severity: "info", type: "connection.created", actor: "owner", userId, connectionId: id,
      message: "Connection created", detail: { provider: input.provider, label },
    });
    return id;
  });
}

export function setConnectionEnabled(db: DatabaseSync, userId: number, id: number, enabled: boolean) {
  inTransaction(db, () => {
    const row = connection(db, userId, id);
    if (enabled && !row.credential_encrypted) throw new Error("Add a credential before enabling this connection");
    db.prepare("UPDATE connections SET enabled = ? WHERE id = ? AND user_id = ?").run(Number(enabled), id, userId);
    recordEvent(db, {
      severity: "info", type: enabled ? "connection.enabled" : "connection.disabled", actor: "owner", userId,
      connectionId: id, message: enabled ? "Connection enabled" : "Connection disabled",
    });
  });
}

export function replaceCredential(db: DatabaseSync, userId: number, key: Buffer, id: number, credential: string) {
  inTransaction(db, () => {
    connection(db, userId, id);
    db.prepare("UPDATE connections SET credential_encrypted = ?, status = 'active', last_error = NULL WHERE id = ? AND user_id = ?")
      .run(encrypt(key, "connection-credential", secret(credential)), id, userId);
    recordEvent(db, {
      severity: "info", type: "connection.credential_replaced", actor: "owner", userId, connectionId: id,
      message: "Connection credential replaced",
    });
  });
}

export function deleteConnection(db: DatabaseSync, userId: number, id: number) {
  inTransaction(db, () => {
    const { label } = connection(db, userId, id);
    db.prepare("DELETE FROM connections WHERE id = ? AND user_id = ?").run(id, userId);
    recordEvent(db, {
      severity: "notice", type: "connection.deleted", actor: "owner", userId,
      message: "Connection deleted", detail: { connectionId: id, label },
    });
  });
}

function context(db: DatabaseSync, userId: number, key: Buffer, adapter: ProviderAdapter, now: Date, request: typeof fetch | undefined, nonce?: string): ProviderContext {
  const settings = providerSettings(db, userId, key, adapter.key);
  return { settings, request: request ?? adapter.transport?.(settings) ?? fetch, now, nonce };
}

function existing(db: DatabaseSync, userId: number, key: Buffer, adapter: ProviderAdapter, id: number | undefined) {
  if (id === undefined) return undefined;
  const row = db.prepare("SELECT provider, credential_encrypted FROM connections WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) throw new Error("Connection not found");
  if (row.provider !== adapter.key) throw new Error("The adapter does not match the connection provider");
  return row.credential_encrypted ? decrypt(key, "connection-credential", String(row.credential_encrypted)) : undefined;
}

export async function beginConnection(db: DatabaseSync, userId: number, key: Buffer, adapter: ProviderAdapter, options: ConnectOptions = {}) {
  const now = options.now ?? new Date();
  providerOn(db, userId, adapter.key);
  const credential = existing(db, userId, key, adapter, options.connectionId);
  const nonce = randomBytes(16).toString("base64url");
  const start: ConnectStart = await adapter.beginConnect(context(db, userId, key, adapter, now, options.request, nonce), credential);
  const body = Buffer.from(JSON.stringify({ n: nonce, p: adapter.key, u: userId, c: options.connectionId ?? null, e: now.getTime() + STATE_TTL })).toString("base64url");
  return { start, state: body + "." + sign(key, "connect-state", body) };
}

function openState(key: Buffer, userId: number, adapter: ProviderAdapter, state: string, now: Date) {
  try {
    const [body, signature, ...extra] = String(state).split(".");
    if (!body || !signature || extra.length || !verify(key, "connect-state", body, signature)) throw new Error();
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (claims.p !== adapter.key || claims.u !== userId || typeof claims.n !== "string" || !Number.isFinite(claims.e) || claims.e < now.getTime() ||
      !(claims.c === null || Number.isInteger(claims.c))) throw new Error();
    return { nonce: claims.n as string, connectionId: claims.c as number | null };
  } catch {
    throw new Error(EXPIRED);
  }
}

export async function completeConnection(db: DatabaseSync, userId: number, key: Buffer, adapter: ProviderAdapter, state: string, payload: unknown, options: ConnectOptions = {}) {
  const now = options.now ?? new Date();
  const claims = openState(key, userId, adapter, state, now);
  const repair = claims.connectionId ?? undefined;
  const credential = existing(db, userId, key, adapter, repair);
  const result = await adapter.completeConnect(context(db, userId, key, adapter, now, options.request, claims.nonce), payload, credential);
  if (repair === undefined) return createConnection(db, userId, key, { provider: adapter.key, label: result.label, credential: result.credential });
  replaceCredential(db, userId, key, repair, result.credential);
  return repair;
}

export async function disconnectAndDelete(db: DatabaseSync, userId: number, key: Buffer, adapter: ProviderAdapter, id: number, options: ConnectOptions = {}) {
  const row = db.prepare("SELECT provider, label, credential_encrypted FROM connections WHERE id = ? AND user_id = ?").get(id, userId);
  if (!row) throw new Error("Connection not found");
  if (row.provider !== adapter.key) throw new Error("The adapter does not match the connection provider");
  let failed = false;
  if (adapter.disconnect && row.credential_encrypted) {
    try {
      const credential = decrypt(key, "connection-credential", String(row.credential_encrypted));
      await adapter.disconnect(context(db, userId, key, adapter, options.now ?? new Date(), options.request), credential);
    } catch {
      failed = true;
    }
  }
  inTransaction(db, () => {
    if (failed) {
      recordEvent(db, {
        severity: "warning", type: "connection.disconnect_failed", actor: "owner", userId,
        message: "The provider could not be told to disconnect", detail: { connectionId: id, label: row.label },
      });
    }
  });
  deleteConnection(db, userId, id);
}

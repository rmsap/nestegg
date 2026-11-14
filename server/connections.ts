import type { DatabaseSync } from "node:sqlite";
import { recordEvent } from "./events.ts";
import { encrypt } from "./secrets.ts";

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

function connection(db: DatabaseSync, id: number) {
  const row = db.prepare("SELECT label, enabled, credential_encrypted FROM connections WHERE id = ?").get(id);
  if (!row) throw new Error("Connection not found");
  return row;
}

function secret(credential: string) {
  if (typeof credential !== "string" || !credential.trim()) throw new Error("A credential is required");
  return credential;
}

export function createConnection(db: DatabaseSync, key: Buffer, input: { provider: string; label: string; credential: string }) {
  return inTransaction(db, () => {
    const provider = db.prepare("SELECT enabled FROM providers WHERE key = ?").get(input.provider);
    if (!provider) throw new Error("Unknown provider");
    if (!provider.enabled) throw new Error("This provider is disabled");
    const label = String(input.label ?? "").trim();
    if (label.length < 1 || label.length > 80) throw new Error("Label must be 1 to 80 characters");
    const encrypted = encrypt(key, "connection-credential", secret(input.credential));
    const id = Number(db.prepare(
      "INSERT INTO connections (provider, label, enabled, status, credential_encrypted) VALUES (?, ?, 0, 'active', ?) RETURNING id"
    ).get(input.provider, label, encrypted)?.id);
    recordEvent(db, {
      severity: "info", type: "connection.created", actor: "owner", connectionId: id,
      message: "Connection created", detail: { provider: input.provider, label },
    });
    return id;
  });
}

export function setConnectionEnabled(db: DatabaseSync, id: number, enabled: boolean) {
  inTransaction(db, () => {
    const row = connection(db, id);
    if (enabled && !row.credential_encrypted) throw new Error("Add a credential before enabling this connection");
    db.prepare("UPDATE connections SET enabled = ? WHERE id = ?").run(Number(enabled), id);
    recordEvent(db, {
      severity: "info", type: enabled ? "connection.enabled" : "connection.disabled", actor: "owner",
      connectionId: id, message: enabled ? "Connection enabled" : "Connection disabled",
    });
  });
}

export function replaceCredential(db: DatabaseSync, key: Buffer, id: number, credential: string) {
  inTransaction(db, () => {
    connection(db, id);
    db.prepare("UPDATE connections SET credential_encrypted = ?, status = 'active', last_error = NULL WHERE id = ?")
      .run(encrypt(key, "connection-credential", secret(credential)), id);
    recordEvent(db, {
      severity: "info", type: "connection.credential_replaced", actor: "owner", connectionId: id,
      message: "Connection credential replaced",
    });
  });
}

export function deleteConnection(db: DatabaseSync, id: number) {
  inTransaction(db, () => {
    const { label } = connection(db, id);
    db.prepare("DELETE FROM connections WHERE id = ?").run(id);
    recordEvent(db, {
      severity: "notice", type: "connection.deleted", actor: "owner",
      message: "Connection deleted", detail: { connectionId: id, label },
    });
  });
}

export function setSyncInterval(db: DatabaseSync, providerKey: string, minutes: number) {
  inTransaction(db, () => {
    const provider = db.prepare("SELECT min_sync_interval_minutes AS floor FROM providers WHERE key = ?").get(providerKey);
    if (!provider) throw new Error("Unknown provider");
    const floor = Number(provider.floor);
    if (!Number.isInteger(minutes) || minutes < floor || minutes > 10080) {
      throw new Error(`Sync interval must be a whole number of minutes from ${floor} to 10080`);
    }
    db.prepare("UPDATE providers SET sync_interval_minutes = ? WHERE key = ?").run(minutes, providerKey);
    recordEvent(db, {
      severity: "info", type: "provider.interval_changed", actor: "owner",
      message: "Sync interval changed", detail: { provider: providerKey, minutes },
    });
  });
}

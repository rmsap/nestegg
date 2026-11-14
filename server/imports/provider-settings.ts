import type { DatabaseSync } from "node:sqlite";
import { recordEvent } from "../events.ts";
import { decrypt, encrypt } from "../secrets.ts";
import type { ProviderAdapter } from "./transaction-provider.ts";

const PURPOSE = "provider-settings";
const MAX = 20_000;

export function providerSettings(db: DatabaseSync, userId: number, key: Buffer, providerKey: string): Record<string, string> {
  const row = db.prepare("SELECT settings_encrypted FROM user_providers WHERE user_id = ? AND provider = ?").get(userId, providerKey);
  if (!row?.settings_encrypted) return {};
  const values = JSON.parse(decrypt(key, PURPOSE, String(row.settings_encrypted)));
  return values && typeof values === "object" ? values : {};
}

export function setProviderSettings(db: DatabaseSync, userId: number, key: Buffer, adapter: ProviderAdapter, values: Record<string, unknown>) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM providers WHERE key = ?").get(adapter.key)) throw new Error("Unknown provider");
    if (!values || typeof values !== "object") throw new Error("Settings must be an object");
    const fields = new Map(adapter.settings.map((field) => [field.name, field]));
    for (const name of Object.keys(values)) if (!fields.has(name)) throw new Error("Unknown setting " + name);
    const current = providerSettings(db, userId, key, adapter.key);
    const next = { ...current };
    const changed: string[] = [];
    for (const field of adapter.settings) {
      const value = values[field.name];
      if (value === undefined) continue;
      if (typeof value !== "string") throw new Error(`${field.label} must be text`);
      if (value.length > MAX) throw new Error(`${field.label} is too long`);
      const keep = value === "" && (field.kind === "secret" || field.kind === "file");
      if (keep) continue;
      if (field.kind === "choice" && value !== "" && !field.choices?.some((choice) => choice.value === value)) {
        throw new Error(`${field.label} is not one of the choices`);
      }
      if (value === "") delete next[field.name];
      else next[field.name] = value;
      if (next[field.name] !== current[field.name]) changed.push(field.name);
    }
    for (const field of adapter.settings) {
      if (field.required && !next[field.name]) throw new Error(`${field.label} is required`);
    }
    db.prepare(`
      INSERT INTO user_providers (user_id, provider, settings_encrypted, sync_interval_minutes)
      SELECT ?, key, ?, default_sync_interval_minutes FROM providers WHERE key = ?
      ON CONFLICT(user_id, provider) DO UPDATE SET settings_encrypted = excluded.settings_encrypted
    `).run(userId, encrypt(key, PURPOSE, JSON.stringify(next)), adapter.key);
    recordEvent(db, {
      severity: "info", type: "provider.settings_changed", actor: "owner", userId,
      message: "Provider settings changed", detail: { provider: adapter.key, fields: changed },
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function describeProviderSettings(db: DatabaseSync, userId: number, key: Buffer, adapter: ProviderAdapter) {
  const values = providerSettings(db, userId, key, adapter.key);
  return adapter.settings.map((field) => field.kind === "secret" || field.kind === "file"
    ? { ...field, set: Boolean(values[field.name]) }
    : { ...field, value: values[field.name] ?? "" });
}

export function setProviderEnabled(db: DatabaseSync, userId: number, providerKey: string, enabled: boolean) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM providers WHERE key = ?").get(providerKey)) throw new Error("Unknown provider");
    db.prepare(`
      INSERT INTO user_providers (user_id, provider, enabled, sync_interval_minutes)
      SELECT ?, key, ?, default_sync_interval_minutes FROM providers WHERE key = ?
      ON CONFLICT(user_id, provider) DO UPDATE SET enabled = excluded.enabled
    `).run(userId, Number(enabled), providerKey);
    recordEvent(db, {
      severity: "info", type: enabled ? "provider.enabled" : "provider.disabled", actor: "owner", userId,
      message: enabled ? "Provider enabled" : "Provider disabled", detail: { provider: providerKey },
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setSyncInterval(db: DatabaseSync, userId: number, providerKey: string, minutes: number) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const provider = db.prepare("SELECT min_sync_interval_minutes AS floor FROM providers WHERE key = ?").get(providerKey);
    if (!provider) throw new Error("Unknown provider");
    const floor = Number(provider.floor);
    if (!Number.isInteger(minutes) || minutes < floor || minutes > 10080) {
      throw new Error(`Sync interval must be a whole number of minutes from ${floor} to 10080`);
    }
    db.prepare(`
      INSERT INTO user_providers (user_id, provider, sync_interval_minutes) VALUES (?, ?, ?)
      ON CONFLICT(user_id, provider) DO UPDATE SET sync_interval_minutes = excluded.sync_interval_minutes
    `).run(userId, providerKey, minutes);
    recordEvent(db, {
      severity: "info", type: "provider.interval_changed", actor: "owner", userId,
      message: "Sync interval changed", detail: { provider: providerKey, minutes },
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readId } from "../../lib/forms";
import { completeConnection, disconnectAndDelete, setConnectionEnabled, setSyncInterval } from "../../server/connections/mutations";
import { connectionList, providerList } from "../../server/connections/queries";
import { database } from "../../server/db/connection";
import { setProviderEnabled, setProviderSettings } from "../../server/imports/provider-settings";
import { adapters } from "../../server/imports/providers";
import type { ProviderAdapter } from "../../server/imports/transaction-provider";
import { syncConnection } from "../../server/imports/sync";
import { secretKey } from "../../server/secret-key";

function connections(message: string, params: Record<string, string> = {}): never {
  redirect("/connections?" + new URLSearchParams({ notice: message, ...params }).toString());
}

function text(value: FormDataEntryValue | null) {
  return typeof value === "string" ? value : "";
}

function reason(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

function refresh() {
  for (const path of ["/connections", "/accounts", "/transactions", "/budget", "/"]) revalidatePath(path);
}

async function complete(adapter: ProviderAdapter, state: string, payload: unknown) {
  const known = new Set(connectionList(database()).map((connection) => connection.id));
  const id = await completeConnection(database(), secretKey(), adapter, state, payload);
  refresh();
  return known.has(id) ? "Connection re-authorized." : "Connection added. Turn it on to start syncing.";
}

function connectionAdapter(form: FormData) {
  const id = readId(form.get("connection"));
  const row = connectionList(database()).find((connection) => connection.id === id);
  const adapter = row && adapters.get(row.provider);
  if (!adapter) connections("That connection no longer exists.");
  return { id, adapter };
}

export async function saveProvider(form: FormData) {
  const adapter = adapters.get(text(form.get("provider")));
  if (!adapter) connections("Choose a provider from the list.");
  const interval = readId(form.get("interval"));
  const enabled = form.get("enabled") === "on";
  try {
    const db = database();
    const current = providerList(db).find((provider) => provider.key === adapter.key);
    if (!current) throw new Error("Unknown provider");
    if (adapter.settings.length) {
      const values: Record<string, string> = {};
      for (const field of adapter.settings) values[field.name] = text(form.get("setting-" + field.name));
      setProviderSettings(db, secretKey(), adapter, values);
    }
    if (interval !== current.sync_interval_minutes) setSyncInterval(db, adapter.key, interval);
    if (enabled !== Boolean(current.enabled)) setProviderEnabled(db, adapter.key, enabled);
  } catch (error) {
    refresh();
    connections(reason(error), { settings: adapter.key });
  }
  refresh();
  connections("Settings saved.");
}

export async function connect(form: FormData) {
  const adapter = adapters.get(text(form.get("provider")));
  if (!adapter) connections("Choose a provider from the list.");
  const connection = readId(form.get("connection"));
  const payload: Record<string, string> = {};
  for (const [name, value] of form) if (name.startsWith("field-") && typeof value === "string") payload[name.slice(6)] = value;
  let notice: string;
  try {
    notice = await complete(adapter, text(form.get("state")), payload);
  } catch (error) {
    connections(reason(error), connection ? { connect: adapter.key, connection: String(connection) } : { connect: adapter.key });
  }
  connections(notice);
}

export async function finishWidget(providerKey: string, state: string, payload: unknown):
  Promise<{ ok: true; notice: string } | { ok: false; message: string }> {
  const adapter = typeof providerKey === "string" ? adapters.get(providerKey) : undefined;
  if (!adapter || typeof state !== "string") return { ok: false, message: "Choose a provider from the list." };
  try {
    return { ok: true, notice: await complete(adapter, state, payload) };
  } catch (error) {
    return { ok: false, message: reason(error) };
  }
}

export async function toggleConnection(form: FormData) {
  const id = readId(form.get("connection"));
  const enabled = form.get("enabled") === "1";
  try {
    setConnectionEnabled(database(), id, enabled);
  } catch (error) {
    connections(reason(error));
  }
  refresh();
  connections(enabled ? "Connection turned on." : "Connection turned off.");
}

export async function syncNow(form: FormData) {
  const { id, adapter } = connectionAdapter(form);
  let notice: string;
  try {
    const result = await syncConnection(database(), secretKey(), id, adapter, { trigger: "manual" });
    notice = `Synced: ${result.added} added, ${result.updated} updated, ${result.removed} removed.`;
  } catch (error) {
    notice = reason(error);
  }
  refresh();
  connections(notice);
}

export async function removeConnection(form: FormData) {
  const { id, adapter } = connectionAdapter(form);
  try {
    await disconnectAndDelete(database(), secretKey(), adapter, id);
  } catch (error) {
    connections(reason(error));
  }
  refresh();
  connections("Connection removed.");
}

import type { ProviderAdapter } from "../imports/transaction-provider.ts";
import type { ConnectionRow, ProviderRow } from "./queries.ts";

export type ConnectionStatus = "Ready" | "Synced" | "Failed" | "Off";
export type ProviderStatus = ConnectionStatus | "Needs keys";

export function connectionStatus(connection: Pick<ConnectionRow, "enabled" | "status" | "last_synced_at">): ConnectionStatus {
  if (!connection.enabled) return "Off";
  if (connection.status !== "active") return "Failed";
  return connection.last_synced_at ? "Synced" : "Ready";
}

export function needsKeys(adapter: Pick<ProviderAdapter, "settings">, provider: Pick<ProviderRow, "configured">) {
  return adapter.settings.some((field) => field.required) && !provider.configured;
}

export function providerStatus(provider: Pick<ProviderRow, "enabled">, keysMissing: boolean,
  connections: Pick<ConnectionRow, "enabled" | "status" | "last_synced_at">[]): ProviderStatus {
  if (!provider.enabled) return "Off";
  if (keysMissing) return "Needs keys";
  const states = connections.map(connectionStatus);
  if (states.includes("Failed")) return "Failed";
  return states.includes("Synced") ? "Synced" : "Ready";
}

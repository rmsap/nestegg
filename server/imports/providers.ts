import type { ProviderAdapter } from "./transaction-provider.ts";

export const adapters = new Map<string, ProviderAdapter>();

export function adapter(key: string) {
  const found = adapters.get(key);
  if (!found) throw new Error("No adapter for provider " + key);
  return found;
}

import type { ProviderAdapter } from "./transaction-provider.ts";
import { teller } from "./teller-sandbox.ts";

export const adapters = new Map<string, ProviderAdapter>([[teller.key, teller]]);

export function adapter(key: string) {
  const found = adapters.get(key);
  if (!found) throw new Error("No adapter for provider " + key);
  return found;
}

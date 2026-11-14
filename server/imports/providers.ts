import { demo } from "./demo.ts";
import { plaid } from "./plaid.ts";
import type { ProviderAdapter } from "./transaction-provider.ts";

export const adapters = new Map<string, ProviderAdapter>([[demo.key, demo], [plaid.key, plaid]]);

export function adapter(key: string) {
  const found = adapters.get(key);
  if (!found) throw new Error("No adapter for provider " + key);
  return found;
}

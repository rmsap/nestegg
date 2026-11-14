import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ProviderRow } from "../../server/connections/queries";
import { needsKeys } from "../../server/connections/status";
import type { ProviderAdapter } from "../../server/imports/transaction-provider";

export type Entry = { adapter: ProviderAdapter; provider: ProviderRow };

export const usable = ({ adapter, provider }: Entry) => Boolean(provider.enabled) && !needsKeys(adapter, provider);

export function ProviderChoices({ entries }: { entries: Entry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted">No providers available</p>;
  return <div className="grid gap-2">
    {entries.map((entry) => {
      const { adapter, provider } = entry;
      const ready = usable(entry);
      const keys = Boolean(provider.enabled) && !ready;
      return <Link className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-3 text-ink hover:bg-accent pointer-coarse:min-h-11"
        href={ready ? `/connections?add=${adapter.key}` : `/connections?provider=${adapter.key}&then=add`} key={adapter.key}>
        <span className="min-w-0 wrap-anywhere">
          <strong className="block">{provider.name}</strong>
          <span className="block text-sm text-muted">{!provider.enabled ? "Turned off. Turn it on in its settings" : ready ? `Sign in through ${provider.name}` : `Add your ${provider.name} keys first`}</span>
        </span>
        {keys
          ? <span className="shrink-0 text-sm font-bold text-primary-text">Set up</span>
          : <ChevronRight className="shrink-0 text-muted" size={16} aria-hidden="true" />}
      </Link>;
    })}
  </div>;
}

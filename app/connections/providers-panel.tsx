import { Settings } from "lucide-react";
import { ButtonLink } from "../../components/ui/button";
import { Panel } from "../../components/ui/panel";
import { intervalWords } from "../../lib/dates";
import type { ConnectionRow } from "../../server/connections/queries";
import { needsKeys, providerStatus } from "../../server/connections/status";
import type { Entry } from "./add-panel";
import { StatusDot } from "./status-dot";

export function ProvidersPanel({ entries, connections }: { entries: Entry[]; connections: ConnectionRow[] }) {
  return <Panel heading="Providers">
    {entries.length === 0 && <p className="text-sm text-muted">No providers available</p>}
    <div className="divide-y divide-line">
      {entries.map(({ adapter, provider }) => <div className="grid gap-1 py-3" key={adapter.key}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <strong className="min-w-0 wrap-anywhere">{provider.name}</strong>
          <StatusDot status={providerStatus(provider, needsKeys(adapter, provider), connections.filter((item) => item.provider === adapter.key))} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="text-sm text-muted">Syncs every {intervalWords(provider.sync_interval_minutes)}</p>
          <ButtonLink href={`/connections?provider=${adapter.key}`} size="sm"><Settings size={16} aria-hidden="true" />Settings</ButtonLink>
        </div>
      </div>)}
    </div>
  </Panel>;
}

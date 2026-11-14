import { ButtonLink } from "../../components/ui/button";
import { Panel } from "../../components/ui/panel";
import type { ProviderRow } from "../../server/connections/queries";
import { needsKeys } from "../../server/connections/status";
import type { ProviderAdapter } from "../../server/imports/transaction-provider";

export type Entry = { adapter: ProviderAdapter; provider: ProviderRow };

export const usable = ({ adapter, provider }: Entry) => Boolean(provider.enabled) && !needsKeys(adapter, provider);

export function AddPanel({ entries }: { entries: Entry[] }) {
  return <Panel heading="Add a connection" headingAside={<ButtonLink href="/connections">Cancel</ButtonLink>}>
    {entries.length === 0 && <p className="text-sm text-muted">No providers available</p>}
    {entries.map((entry) => {
      const { adapter, provider } = entry;
      const off = !provider.enabled;
      return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line py-3" key={adapter.key}>
        <div className="min-w-0 wrap-anywhere">
          <strong>{provider.name}</strong>
          <p className="text-sm text-muted">{off ? "Turn on in provider settings" : usable(entry) ? "Ready to connect" : "Add its keys first"}</p>
        </div>
        {off
          ? <ButtonLink href={`/connections?provider=${adapter.key}`}>Settings</ButtonLink>
          : usable(entry)
            ? <ButtonLink href={`/connections?add=${adapter.key}`} variant="primary">Choose</ButtonLink>
            : <ButtonLink href={`/connections?provider=${adapter.key}`}>Set up</ButtonLink>}
      </div>;
    })}
  </Panel>;
}

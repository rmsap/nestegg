import { Button, ButtonLink } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Panel } from "../../components/ui/panel";
import { Switch } from "../../components/ui/switch";
import { intervalWords } from "../../lib/dates";
import type { ConnectionRow } from "../../server/connections/queries";
import { needsKeys, providerStatus } from "../../server/connections/status";
import { database } from "../../server/db/connection";
import { describeProviderSettings } from "../../server/imports/provider-settings";
import { secretKey } from "../../server/secret-key";
import { saveProvider } from "./actions";
import type { Entry } from "./add-panel";
import { FieldInputs } from "./field-inputs";
import { StatusDot } from "./status-dot";

export function ProvidersPanel({ entries, connections, open }: { entries: Entry[]; connections: ConnectionRow[]; open?: string }) {
  return <Panel heading="Providers">
    {entries.length === 0 && <p className="mt-3 text-sm text-muted">No providers available</p>}
    {entries.map(({ adapter, provider }) => <div className="mt-3 border-t border-line pt-3" key={adapter.key}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="min-w-0">{provider.name}</h3>
        <StatusDot status={providerStatus(provider, needsKeys(adapter, provider), connections.filter((item) => item.provider === adapter.key))} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <p className="text-sm text-muted">Syncs every {intervalWords(provider.sync_interval_minutes)}</p>
        <ButtonLink href={`/connections?provider=${adapter.key}`} variant="quiet">Settings</ButtonLink>
      </div>
      {open === adapter.key && <form className="mt-3 grid gap-3" action={saveProvider}>
        <input type="hidden" name="provider" value={adapter.key} />
        <FieldInputs fields={describeProviderSettings(database(), secretKey(), adapter)} prefix="setting-" />
        <Field label="Sync every (minutes)">
          <input name="interval" type="number" min={provider.min_sync_interval_minutes} max="10080" step="1"
            defaultValue={provider.sync_interval_minutes} required />
        </Field>
        <Switch name="enabled" label="Provider on" defaultChecked={Boolean(provider.enabled)} />
        <div className="flex flex-wrap items-end gap-2.5">
          <Button type="submit" variant="primary">Save settings</Button>
          <ButtonLink href="/connections">Close</ButtonLink>
        </div>
      </form>}
    </div>)}
  </Panel>;
}

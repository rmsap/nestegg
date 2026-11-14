import { Button, ButtonLink } from "../../components/ui/button";
import { Chip } from "../../components/ui/chip";
import { Field } from "../../components/ui/field";
import { Panel } from "../../components/ui/panel";
import { Switch } from "../../components/ui/switch";
import { beginConnection } from "../../server/connections/mutations";
import type { ConnectionRow as Connection, ProviderRow, SyncRunRow } from "../../server/connections/queries";
import { database } from "../../server/db/connection";
import { describeProviderSettings } from "../../server/imports/provider-settings";
import type { ProviderAdapter } from "../../server/imports/transaction-provider";
import { secretKey } from "../../server/secret-key";
import { connect, saveProvider } from "./actions";
import { ConnectionRow } from "./connection-row";
import { FieldInputs } from "./field-inputs";
import { PlaidLink } from "./plaid-link";

async function ConnectStep({ adapter, name, connectionId }: { adapter: ProviderAdapter; name: string; connectionId?: number }) {
  const url = "/connections";
  let begun;
  try {
    begun = await beginConnection(database(), secretKey(), adapter, { connectionId });
  } catch (error) {
    return <p className="notice" role="status">{error instanceof Error ? error.message : "Could not start the connection."}</p>;
  }
  const { start, state } = begun;
  if (start.kind === "form") {
    return <form className="fields" action={connect}>
      <input type="hidden" name="provider" value={adapter.key} />
      <input type="hidden" name="state" value={state} />
      {connectionId && <input type="hidden" name="connection" value={connectionId} />}
      <FieldInputs fields={start.fields} prefix="field-" />
      <Button type="submit" variant="primary">{connectionId ? "Re-authorize" : "Connect"}</Button>
      <ButtonLink href={url}>Cancel</ButtonLink>
    </form>;
  }
  if (start.kind === "widget" && start.widget === "plaid-link") {
    return <div className="actions">
      <PlaidLink providerKey={adapter.key} linkToken={start.params.linkToken} state={state}
        mode={start.params.mode === "update" ? "update" : "create"} />
      <ButtonLink href={url}>Cancel</ButtonLink>
    </div>;
  }
  if (start.kind === "redirect") return <a className="button primary" href={start.url}>Continue to {name}</a>;
  return <p className="muted">This provider's sign-in is not available in this version.</p>;
}

export function ProviderPanel({ adapter, provider, connections, runs, settingsOpen, connecting, connectionId }: {
  adapter: ProviderAdapter;
  provider: ProviderRow;
  connections: Connection[];
  runs: Map<number, SyncRunRow[]>;
  settingsOpen: boolean;
  connecting: boolean;
  connectionId?: number;
}) {
  const needsKeys = adapter.settings.some((field) => field.required) && !provider.configured;
  const url = "/connections";
  return <Panel heading={provider.name} headingAside={<div className="actions">
    {!provider.enabled ? <Chip>Off</Chip> : needsKeys ? <Chip className="chip-warning">Needs keys</Chip> : <Chip>Ready</Chip>}
    <ButtonLink href={settingsOpen ? url : `${url}?settings=${provider.key}`}>{settingsOpen ? "Close" : "Settings"}</ButtonLink>
  </div>}>
    {settingsOpen && <form className="fields" action={saveProvider}>
      <input type="hidden" name="provider" value={provider.key} />
      <FieldInputs fields={describeProviderSettings(database(), secretKey(), adapter)} prefix="setting-" />
      <Field label="Sync every (minutes)">
        <input name="interval" type="number" min={provider.min_sync_interval_minutes} max="10080" step="1"
          defaultValue={provider.sync_interval_minutes} required />
      </Field>
      <Switch name="enabled" label="Provider on" defaultChecked={Boolean(provider.enabled)} />
      <Button type="submit" variant="primary">Save settings</Button>
    </form>}
    {connections.length === 0 && <p className="muted">No connections yet.</p>}
    {connections.map((connection) => <ConnectionRow key={connection.id} connection={connection}
      runs={runs.get(connection.id) ?? []} providerKey={provider.key} />)}
    <div className="connect">
      {connecting
        ? <ConnectStep adapter={adapter} name={provider.name} connectionId={connectionId} />
        : provider.enabled && !needsKeys
          ? <ButtonLink href={`${url}?connect=${provider.key}`} variant="primary">Add connection</ButtonLink>
          : <p className="muted">{provider.enabled
            ? "Add this provider's keys in Settings to connect a bank."
            : "Turn this provider on in Settings to connect a bank."}</p>}
    </div>
  </Panel>;
}

import { PageHeading } from "../../components/page-heading";
import { Chip } from "../../components/ui/chip";
import { Panel } from "../../components/ui/panel";
import { dateTime } from "../../lib/dates";
import { readId } from "../../lib/forms";
import { connectionList, providerList, recentEvents, recentRuns } from "../../server/connections/queries";
import { database } from "../../server/db/connection";
import { adapters } from "../../server/imports/providers";
import { PlaidResume } from "./plaid-link";
import { ProviderPanel } from "./provider-panel";

export const dynamic = "force-dynamic";

type Param = string | string[];

export default async function ConnectionsPage({ searchParams }: {
  searchParams: Promise<{ settings?: Param; connect?: Param; connection?: Param; notice?: Param; oauth_state_id?: Param }>;
}) {
  const { settings, connect, connection, notice, oauth_state_id: oauth } = await searchParams;
  const db = database();
  const providers = providerList(db);
  const connections = connectionList(db);
  const runs = new Map(connections.map((item) => [item.id, recentRuns(db, item.id)]));
  const events = recentEvents(db);
  const connectionId = readId(typeof connection === "string" ? connection : null) || undefined;

  return <>
    <PageHeading title="Connections" />
    {typeof notice === "string" && <p className="notice" role="status">{notice}</p>}
    {typeof oauth === "string" && <Panel heading="Finishing sign-in"><PlaidResume /></Panel>}
    {[...adapters.values()].map((adapter) => {
      const provider = providers.find((row) => row.key === adapter.key);
      return provider && <ProviderPanel key={adapter.key} adapter={adapter} provider={provider} runs={runs}
        connections={connections.filter((item) => item.provider === adapter.key)}
        settingsOpen={settings === adapter.key} connecting={connect === adapter.key} connectionId={connectionId} />;
    })}
    <Panel heading="Recent activity">
      {events.length === 0 && <p className="muted">No activity yet.</p>}
      {events.map((event, index) => <div className="log-row" key={index}>
        <span className="muted">{dateTime(event.at)}</span>
        <div>
          {event.severity === "warning" && <><Chip className="chip-warning">Warning</Chip>{" "}</>}
          {event.severity === "error" && <><Chip className="chip-danger">Error</Chip>{" "}</>}
          {event.message}
          {event.connection && <span className="muted"> · {event.connection}</span>}
        </div>
      </div>)}
    </Panel>
  </>;
}

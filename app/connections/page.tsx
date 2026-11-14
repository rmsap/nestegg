import { PageHeading } from "../../components/page-heading";
import { ButtonLink } from "../../components/ui/button";
import { Panel } from "../../components/ui/panel";
import { ago } from "../../lib/dates";
import { readId } from "../../lib/forms";
import { connectionAccounts, connectionList, providerList, readouts, recentEvents, recentRuns } from "../../server/connections/queries";
import { connectionStatus } from "../../server/connections/status";
import { database } from "../../server/db/connection";
import { adapters } from "../../server/imports/providers";
import { ActivityPanel } from "./activity-panel";
import { AddPanel, usable, type Entry } from "./add-panel";
import { ConnectionBlock, FixAction } from "./connection-block";
import { ConnectStep } from "./connect-step";
import { PlaidResume } from "./plaid-link";
import { ProvidersPanel } from "./providers-panel";
import { ReadoutStrip } from "./readout-strip";

export const dynamic = "force-dynamic";

type Param = string | string[];

export default async function ConnectionsPage({ searchParams }: {
  searchParams: Promise<{ add?: Param; provider?: Param; reauthorize?: Param; activity?: Param; notice?: Param; oauth_state_id?: Param }>;
}) {
  const { add, provider: open, reauthorize, activity, notice, oauth_state_id: oauth } = await searchParams;
  const db = database();
  const now = new Date();
  const providers = providerList(db);
  const stats = readouts(db);
  const accounts = connectionAccounts(db);
  const expanded = activity === "all";
  const events = recentEvents(db, expanded ? 50 : 5);
  const entries: Entry[] = [...adapters.values()].flatMap((adapter) => {
    const provider = providers.find((row) => row.key === adapter.key);
    return provider ? [{ adapter, provider }] : [];
  });
  const all = connectionList(db);
  const items = all.map((connection) => ({ connection, status: connectionStatus(connection) }))
    .sort((a, b) => Number(b.status === "Failed") - Number(a.status === "Failed") || a.connection.label.localeCompare(b.connection.label));
  const failed = items.filter((item) => item.status === "Failed");
  const adding = typeof add === "string" ? entries.find((entry) => entry.adapter.key === add && usable(entry)) : undefined;
  const repairId = readId(typeof reauthorize === "string" ? reauthorize : null);
  const nameOf = (key: string) => entries.find((entry) => entry.adapter.key === key)?.provider.name;
  const keep = new URLSearchParams();
  for (const [name, value] of Object.entries({ add, provider: open, reauthorize })) if (typeof value === "string") keep.set(name, value);
  const activityHref = (all: boolean) => "/connections?" + new URLSearchParams([...keep, ...(all ? [["activity", "all"]] : [])]).toString();

  return <>
    <PageHeading title="Connections" action={<ButtonLink href="/connections?add=1" variant="primary">Add connection</ButtonLink>} />
    {typeof notice === "string" && <p className="mb-4 rounded-lg bg-accent px-2.5 py-1.5 text-sm" role="status">{notice}</p>}
    {typeof oauth === "string" && <Panel className="mb-4" heading="Finishing sign-in"><PlaidResume /></Panel>}
    <ReadoutStrip connections={stats.connections} accounts={stats.accounts} needAttention={stats.needAttention}
      lastSynced={stats.lastSyncedAt ? ago(stats.lastSyncedAt, now) : "Never"} />
    <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 gap-4">
        {add === "1" && <AddPanel entries={entries} />}
        {adding && <Panel heading={`Connect ${adding.provider.name}`} headingAside={<ButtonLink href="/connections?add=1">Back</ButtonLink>}>
          <ConnectStep adapter={adding.adapter} name={adding.provider.name} />
        </Panel>}
        {failed.length > 0 && <Panel id="attention" heading="Needs attention">
          {failed.map(({ connection }) => <div className="flex flex-wrap items-start justify-between gap-3 border-t border-line py-3" key={connection.id}>
            <div className="min-w-0 wrap-anywhere">
              <strong>{connection.label}</strong>
              <p className="text-sm text-danger">{connection.last_error ?? "The last sync did not finish."}</p>
            </div>
            <FixAction connection={connection} />
          </div>)}
        </Panel>}
        <Panel heading="Connections">
          {items.length === 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <p className="text-sm text-muted">No banks connected yet</p>
            <ButtonLink href="/connections?add=1" variant="primary">Add connection</ButtonLink>
          </div>}
          {items.map(({ connection, status }) => {
            const adapter = adapters.get(connection.provider);
            return <ConnectionBlock key={connection.id} connection={connection} status={status} now={now}
              providerName={nameOf(connection.provider) ?? "Unknown provider"}
              accounts={accounts.get(connection.id) ?? []} runs={recentRuns(db, connection.id)}
              repair={adapter && repairId === connection.id
                ? <ConnectStep adapter={adapter} name={nameOf(connection.provider) ?? ""} connectionId={connection.id} cancelHref="/connections" />
                : null} />;
          })}
        </Panel>
      </div>
      <div className="grid min-w-0 gap-4">
        <ProvidersPanel entries={entries} connections={all} open={typeof open === "string" ? open : undefined} />
        <ActivityPanel events={events} expanded={expanded} moreHref={activityHref(true)} lessHref={activityHref(false)} />
      </div>
    </div>
  </>;
}

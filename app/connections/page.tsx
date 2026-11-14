import type { ReactNode } from "react";
import { PageHeading } from "../../components/page-heading";
import { ButtonLink } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { Panel } from "../../components/ui/panel";
import { ago } from "../../lib/dates";
import { readId } from "../../lib/forms";
import { connectionAccounts, connectionList, providerList, readouts, recentEvents, recentRuns } from "../../server/connections/queries";
import { connectionStatus } from "../../server/connections/status";
import { database } from "../../server/db/connection";
import { adapters } from "../../server/imports/providers";
import { ActivityPanel } from "./activity-panel";
import { ProviderChoices, usable, type Entry } from "./add-panel";
import { AccountList, ConnectionBlock, FixAction } from "./connection-block";
import { ConnectStep } from "./connect-step";
import { PlaidResume } from "./plaid-link";
import { ProviderSettingsForm } from "./provider-settings-form";
import { ProvidersPanel } from "./providers-panel";
import { ReadoutStrip } from "./readout-strip";

export const dynamic = "force-dynamic";

type Param = string | string[];

export default async function ConnectionsPage({ searchParams }: {
  searchParams: Promise<{ added?: Param; add?: Param; provider?: Param; then?: Param; reauthorize?: Param; activity?: Param; notice?: Param; oauth_state_id?: Param }>;
}) {
  const { added, add, provider: open, then, reauthorize, activity, notice, oauth_state_id: oauth } = await searchParams;
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
  const nameOf = (key: string) => entries.find((entry) => entry.adapter.key === key)?.provider.name;
  const message = typeof notice === "string" ? notice : undefined;
  const inline = message && <p className="rounded-lg bg-accent px-2.5 py-1.5 text-sm" role="status">{message}</p>;

  let modal: ReactNode = null;
  if (typeof added === "string") {
    const done = all.find((connection) => connection.id === readId(added));
    if (done) modal = <Modal title={`${done.label} connected`} closeHref="/connections" step={{ current: 3, total: 3 }}>
      <div className="grid gap-4">
        {message && <p>{message}</p>}
        <AccountList accounts={accounts.get(done.id) ?? []} />
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href="/connections" variant="primary">Done</ButtonLink>
          <ButtonLink href="/connections?add=1">Add another</ButtonLink>
        </div>
      </div>
    </Modal>;
  } else if (typeof add === "string") {
    const adding = entries.find((entry) => entry.adapter.key === add && usable(entry));
    if (add === "1") modal = <Modal title="Choose a provider" closeHref="/connections" step={{ current: 1, total: 3 }}>
      <ProviderChoices entries={entries} />
    </Modal>;
    else if (adding) modal = <Modal title={`Connect through ${adding.provider.name}`} closeHref="/connections" step={{ current: 2, total: 3 }}>
      <div className="grid gap-3">
        {inline}
        <ConnectStep adapter={adding.adapter} name={adding.provider.name} back={{ href: "/connections?add=1", label: "Back" }} />
      </div>
    </Modal>;
  } else if (typeof reauthorize === "string") {
    const target = all.find((connection) => connection.id === readId(reauthorize));
    const adapter = target && adapters.get(target.provider);
    if (target && adapter) modal = <Modal title={`Re-authorize ${target.label}`} closeHref="/connections">
      <div className="grid gap-3">
        {inline}
        <ConnectStep adapter={adapter} name={nameOf(target.provider) ?? ""} connectionId={target.id} back={{ href: "/connections", label: "Cancel" }} />
      </div>
    </Modal>;
  } else if (typeof open === "string") {
    const entry = entries.find((item) => item.adapter.key === open);
    if (entry) modal = <Modal title={`${entry.provider.name} settings`} closeHref="/connections">
      <div className="grid gap-3">
        {inline}
        <ProviderSettingsForm {...entry} then={then === "add"} />
      </div>
    </Modal>;
  }

  return <>
    <PageHeading title="Connections" action={<ButtonLink href="/connections?add=1" variant="primary">Add connection</ButtonLink>} />
    {!modal && message && <div className="mb-4">{inline}</div>}
    {typeof oauth === "string" && <Panel className="mb-4" heading="Finishing sign-in"><PlaidResume /></Panel>}
    <ReadoutStrip connections={stats.connections} accounts={stats.accounts} needAttention={stats.needAttention}
      lastSynced={stats.lastSyncedAt ? ago(stats.lastSyncedAt, now) : "Never"} />
    <div className="grid items-start gap-4 min-[980px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 gap-4">
        {failed.length > 0 && <Panel id="attention" heading="Needs attention">
          <div className="divide-y divide-line">
            {failed.map(({ connection }) => <div className="flex flex-wrap items-start justify-between gap-3 py-3" key={connection.id}>
              <div className="min-w-0 wrap-anywhere">
                <strong>{connection.label}</strong>
                <p className="text-sm text-danger">{connection.last_error ?? "The last sync did not finish."}</p>
              </div>
              <FixAction connection={connection} />
            </div>)}
          </div>
        </Panel>}
        <Panel heading="Connections">
          {items.length === 0 && <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">No banks connected yet</p>
            <ButtonLink href="/connections?add=1" variant="primary" size="sm">Add connection</ButtonLink>
          </div>}
          <div className="divide-y divide-line">
            {items.map(({ connection, status }) => <ConnectionBlock key={connection.id} connection={connection} status={status} now={now}
              providerName={nameOf(connection.provider) ?? "Unknown provider"}
              accounts={accounts.get(connection.id) ?? []} runs={recentRuns(db, connection.id)} />)}
          </div>
        </Panel>
      </div>
      <div className="grid min-w-0 gap-4">
        <ProvidersPanel entries={entries} connections={all} />
        <ActivityPanel events={events} expanded={expanded} now={now}
          moreHref="/connections?activity=all" lessHref="/connections" />
      </div>
    </div>
    {modal}
  </>;
}

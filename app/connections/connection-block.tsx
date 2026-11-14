import { ChevronRight, RefreshCw } from "lucide-react";
import { Button, ButtonLink, buttonClass } from "../../components/ui/button";
import { dateTime, ago } from "../../lib/dates";
import { money } from "../../lib/finance";
import type { ConnectionRow, LinkedAccount, SyncRunRow } from "../../server/connections/queries";
import type { ConnectionStatus } from "../../server/connections/status";
import { removeConnection, syncNow, toggleConnection } from "./actions";
import { StatusDot } from "./status-dot";

const runStatus: Record<string, string> = { ok: "Succeeded", failed: "Failed", running: "Running" };
const kinds: Record<string, string> = {
  bank: "Bank account", credit_card: "Credit card", loan: "Loan", investment: "Investment", other: "Other",
};

const hidden = (connection: ConnectionRow) => <input type="hidden" name="connection" value={connection.id} />;

export function AccountList({ accounts }: { accounts: LinkedAccount[] }) {
  if (accounts.length === 0) return <p className="text-sm text-muted">No accounts synced yet</p>;
  return <ul className="grid list-none">
    {accounts.map((account, index) => <li className="flex items-baseline justify-between gap-3 py-1" key={index}>
      <div className="min-w-0 wrap-anywhere">
        {account.name}
        {account.last_four && <span className="text-muted"> •••• {account.last_four}</span>}
        <span className="text-muted"> · {kinds[account.kind] ?? "Other"}</span>
      </div>
      {account.balance_cents === null
        ? <span className="text-sm whitespace-nowrap text-muted">Balance unavailable</span>
        : <span className="text-right whitespace-nowrap tabular-nums">{money(account.balance_cents)}</span>}
    </li>)}
  </ul>;
}

export function FixAction({ connection }: { connection: ConnectionRow }) {
  return connection.status === "needs_reauth"
    ? <ButtonLink href={`/connections?reauthorize=${connection.id}`} variant="primary" size="sm">Re-authorize</ButtonLink>
    : <form action={syncNow}>{hidden(connection)}<Button type="submit" variant="primary" size="sm">Sync now</Button></form>;
}

export function ConnectionBlock({ connection, status, providerName, accounts, runs, now }: {
  connection: ConnectionRow;
  status: ConnectionStatus;
  providerName: string;
  accounts: LinkedAccount[];
  runs: SyncRunRow[];
  now: Date;
}) {
  const on = Boolean(connection.enabled);
  const failed = status === "Failed";
  return <div className="grid gap-3 py-4">
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0 wrap-anywhere"><strong>{connection.label}</strong> <span className="text-sm text-muted">{providerName}</span></div>
        <StatusDot status={status} />
      </div>
      <p className="text-sm text-muted tabular-nums">{connection.last_synced_at
        ? <>Last synced <span title={dateTime(connection.last_synced_at)}>{ago(connection.last_synced_at, now)}</span></>
        : "Never synced"}</p>
      {failed && <p className="mt-1 text-sm text-danger wrap-anywhere">{connection.last_error ?? "The last sync did not finish."}</p>}
    </div>
    <AccountList accounts={accounts} />
    <div className="flex flex-wrap items-center gap-2">
      {failed ? <FixAction connection={connection} /> : on && <form action={syncNow}>
        {hidden(connection)}
        <Button type="submit" size="sm"><RefreshCw size={16} aria-hidden="true" />Sync now</Button>
      </form>}
      {!(failed && connection.status === "needs_reauth") &&
        <ButtonLink href={`/connections?reauthorize=${connection.id}`} size="sm">Re-authorize</ButtonLink>}
      <form action={toggleConnection}>
        {hidden(connection)}
        <input type="hidden" name="enabled" value={on ? "0" : "1"} />
        <Button type="submit" size="sm">{on ? "Turn off" : "Turn on"}</Button>
      </form>
      <details className="relative">
        <summary className={buttonClass({ size: "sm", className: "list-none text-danger! [&::-webkit-details-marker]:hidden" })}>Remove</summary>
        <div className="absolute start-0 z-1 mt-1 w-[min(260px,calc(100vw-68px))] rounded-lg border border-line bg-surface p-3.5 wrap-anywhere shadow-popover">
          <strong>Remove {connection.label}?</strong>
          <p className="text-sm text-muted">Its accounts and transactions stay in Nestegg and stop updating.</p>
          <form className="mt-2" action={removeConnection}>
            {hidden(connection)}
            <Button type="submit" variant="danger" size="sm">Remove connection</Button>
          </form>
        </div>
      </details>
    </div>
    <details className="group">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 text-sm text-muted [&::-webkit-details-marker]:hidden">
        <ChevronRight className="transition-transform group-open:rotate-90 motion-reduce:transition-none" size={16} aria-hidden="true" />
        Recent syncs
      </summary>
      {runs.length === 0 && <p className="mt-2 text-sm text-muted">No syncs yet</p>}
      {runs.map((run, index) => <div className="mt-2 grid grid-cols-[10rem_minmax(0,1fr)] gap-x-3 text-sm compact:grid-cols-1" key={index}>
        <span className="text-muted tabular-nums">{dateTime(run.started_at)}</span>
        <div>
          {run.trigger === "schedule" ? "Scheduled" : "Manual"} · {runStatus[run.status] ?? run.status}
          <p className={`wrap-anywhere ${run.error ? "text-danger" : "text-muted"}`}>{run.error
            ?? `${run.transactions_added} added, ${run.transactions_updated} updated, ${run.transactions_removed} removed`}</p>
        </div>
      </div>)}
    </details>
  </div>;
}

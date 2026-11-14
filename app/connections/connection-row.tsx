import { Button, ButtonLink } from "../../components/ui/button";
import { Chip } from "../../components/ui/chip";
import { dateTime } from "../../lib/dates";
import type { ConnectionRow as Connection, SyncRunRow } from "../../server/connections/queries";
import { removeConnection, syncNow, toggleConnection } from "./actions";

const runStatus: Record<string, string> = { ok: "Succeeded", failed: "Failed", running: "Running" };

export function ConnectionRow({ connection, runs, providerKey }: { connection: Connection; runs: SyncRunRow[]; providerKey: string }) {
  const on = Boolean(connection.enabled);
  const failing = connection.status !== "active";
  const hidden = <input type="hidden" name="connection" value={connection.id} />;
  return <div className="connection-row">
    <div className="connection-head">
      <div>
        <strong>{connection.label}</strong>
        <p className="muted">
          {connection.accounts} {connection.accounts === 1 ? "account" : "accounts"} · {connection.last_synced_at
            ? `Last synced ${dateTime(connection.last_synced_at)}` : "Never synced"}
        </p>
      </div>
      {!on ? <Chip>Off</Chip> : connection.status === "active" ? <Chip>Active</Chip>
        : connection.status === "needs_reauth" ? <Chip className="chip-warning">Needs re-authorization</Chip>
        : <Chip className="chip-danger">Error</Chip>}
    </div>
    {failing && connection.last_error && <p className="error">{connection.last_error}</p>}
    <div className="actions">
      {on && <form action={syncNow}>{hidden}<Button type="submit">Sync now</Button></form>}
      <form action={toggleConnection}>
        {hidden}
        <input type="hidden" name="enabled" value={on ? "0" : "1"} />
        <Button type="submit">{on ? "Turn off" : "Turn on"}</Button>
      </form>
      <ButtonLink href={`/connections?connect=${providerKey}&connection=${connection.id}`}>Re-authorize</ButtonLink>
      <details className="remove">
        <summary>Remove</summary>
        <div className="remove-panel">
          <strong>Remove {connection.label}?</strong>
          <p className="muted">Its accounts and transactions stay in Nestegg and stop updating.</p>
          <form action={removeConnection}>
            {hidden}
            <Button type="submit" variant="danger">Remove connection</Button>
          </form>
        </div>
      </details>
    </div>
    <details className="runs">
      <summary className="muted">Recent syncs</summary>
      {runs.length === 0 && <p className="muted">No syncs yet.</p>}
      {runs.map((run, index) => <div className="log-row" key={index}>
        <span className="muted">{dateTime(run.started_at)}</span>
        <div>
          {run.trigger === "schedule" ? "Scheduled" : "Manual"} · {runStatus[run.status] ?? run.status}
          <p className={run.error ? "error" : "muted"}>{run.error
            ?? `${run.transactions_added} added, ${run.transactions_updated} updated, ${run.transactions_removed} removed`}</p>
        </div>
      </div>)}
    </details>
  </div>;
}

import Link from "next/link";
import { Chip } from "../../components/ui/chip";
import { Panel } from "../../components/ui/panel";
import { dateTime } from "../../lib/dates";
import type { EventRow } from "../../server/connections/queries";

const flags: Record<string, { label: string; className: string }> = {
  warning: { label: "Warning", className: "bg-warning! text-warning-text!" },
  error: { label: "Error", className: "bg-danger! text-on-danger!" },
};

export function ActivityPanel({ events, expanded, moreHref, lessHref }: {
  events: EventRow[];
  expanded: boolean;
  moreHref: string;
  lessHref: string;
}) {
  const flag = (severity: string) => flags[severity];
  return <Panel heading="Recent activity">
    {events.length === 0 && <p className="mt-3 text-sm text-muted">No activity yet</p>}
    {events.map((event, index) => <div className="mt-3 border-t border-line pt-3 text-sm" key={index}>
      <span className="block text-muted tabular-nums">{dateTime(event.at)}</span>
      <div className="wrap-anywhere">
        {flag(event.severity) && <><Chip className={flag(event.severity).className}>{flag(event.severity).label}</Chip>{" "}</>}
        {event.message}
        {event.connection && <span className="text-muted"> · {event.connection}</span>}
      </div>
    </div>)}
    {!expanded && events.length === 5 && <Link className="mt-3 inline-block text-sm" href={moreHref}>Show more</Link>}
    {expanded && events.length > 5 && <Link className="mt-3 inline-block text-sm" href={lessHref}>Show less</Link>}
  </Panel>;
}

import { Chip } from "../../components/ui/chip";
import { ButtonLink } from "../../components/ui/button";
import { Panel } from "../../components/ui/panel";
import { ago, dateTime } from "../../lib/dates";
import type { EventRow } from "../../server/connections/queries";

const flags: Record<string, { label: string; className: string }> = {
  warning: { label: "Warning", className: "bg-warning! text-warning-text!" },
  error: { label: "Error", className: "bg-danger-fill! text-on-danger!" },
};

export function ActivityPanel({ events, expanded, moreHref, lessHref, now }: {
  events: EventRow[];
  expanded: boolean;
  moreHref: string;
  lessHref: string;
  now: Date;
}) {
  const flag = (severity: string) => flags[severity];
  return <Panel heading="Recent activity">
    {events.length === 0 && <p className="text-sm text-muted">No activity yet</p>}
    <div className="divide-y divide-line">
      {events.map((event, index) => <div className="flex flex-wrap items-baseline justify-between gap-x-3 py-2 text-sm" key={index}>
        <div className="min-w-0 wrap-anywhere">
          {flag(event.severity) && <><Chip className={flag(event.severity).className}>{flag(event.severity).label}</Chip>{" "}</>}
          {event.message}
          {event.connection && <span className="text-muted"> · {event.connection}</span>}
        </div>
        <span className="text-sm whitespace-nowrap text-muted tabular-nums" title={dateTime(event.at)}>{ago(event.at, now)}</span>
      </div>)}
    </div>
    {!expanded && events.length === 5 && <ButtonLink className="mt-3" href={moreHref} size="sm">Show more</ButtonLink>}
    {expanded && events.length > 5 && <ButtonLink className="mt-3" href={lessHref} size="sm">Show less</ButtonLink>}
  </Panel>;
}

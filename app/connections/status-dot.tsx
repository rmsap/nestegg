import type { ProviderStatus } from "../../server/connections/status";

const dots: Record<ProviderStatus, string> = {
  Synced: "bg-primary",
  Ready: "bg-warning-text",
  "Needs keys": "bg-warning-text",
  Failed: "bg-danger",
  Off: "bg-muted",
};

export function StatusDot({ status }: { status: ProviderStatus }) {
  return <span className="inline-flex items-center gap-2 text-sm whitespace-nowrap">
    <span className={`size-2 rounded-full ${dots[status]}`} aria-hidden="true" />
    {status}
  </span>;
}

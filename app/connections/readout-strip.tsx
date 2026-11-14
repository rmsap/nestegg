import Link from "next/link";
import type { ReactNode } from "react";

function Cell({ label, children, alert, className = "" }: { label: string; children: ReactNode; alert?: boolean; className?: string }) {
  return <div className={`border-line px-5 py-4 ${alert ? "bg-danger/10" : ""} ${className}`}>
    <span className="block text-sm text-muted">{label}</span>
    <strong className="mt-1 block text-2xl font-bold tabular-nums wrap-anywhere">{children}</strong>
  </div>;
}

export function ReadoutStrip({ connections, accounts, lastSynced, needAttention }: {
  connections: number;
  accounts: number;
  lastSynced: string;
  needAttention: number;
}) {
  return <div className="mb-4 min-w-0 overflow-hidden rounded-[14px] border border-line bg-surface">
    <div className="grid grid-cols-4 divide-x divide-line compact:grid-cols-2">
      <Cell label="Connections">{connections}</Cell>
      <Cell label="Accounts" className="compact:border-e-0"><Link href="/accounts">{accounts}</Link></Cell>
      <Cell label="Last synced" className="compact:border-t">{lastSynced}</Cell>
      <Cell label="Need attention" alert={needAttention > 0} className="compact:border-t">
        {needAttention > 0 ? <Link href="#attention">{needAttention}</Link> : needAttention}
      </Cell>
    </div>
  </div>;
}

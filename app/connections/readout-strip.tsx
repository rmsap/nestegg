import Link from "next/link";
import type { ReactNode } from "react";
import { panelSurface } from "../../components/ui/panel";

function Cell({ label, children, alert }: { label: string; children: ReactNode; alert?: boolean }) {
  return <div className="bg-surface">
    <div className={`h-full px-3 py-2 ${alert ? "bg-danger/10" : ""}`}>
      <span className="block text-sm text-muted">{label}</span>
      <strong className="block text-[1.65rem] tabular-nums wrap-anywhere">{children}</strong>
    </div>
  </div>;
}

export function ReadoutStrip({ connections, accounts, lastSynced, needAttention }: {
  connections: number;
  accounts: number;
  lastSynced: string;
  needAttention: number;
}) {
  return <div className={`${panelSurface} mb-4 bg-surface`}>
    <div className="grid grid-cols-4 gap-px bg-line compact:grid-cols-2">
      <Cell label="Connections">{connections}</Cell>
      <Cell label="Accounts"><Link href="/accounts">{accounts}</Link></Cell>
      <Cell label="Last synced">{lastSynced}</Cell>
      <Cell label="Need attention" alert={needAttention > 0}>
        {needAttention > 0 ? <Link href="#attention">{needAttention}</Link> : needAttention}
      </Cell>
    </div>
  </div>;
}

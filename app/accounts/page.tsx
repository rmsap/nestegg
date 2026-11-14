import { Metric, MetricGrid } from "../../components/metric";
import { PageHeading } from "../../components/page-heading";
import { Panel } from "../../components/ui/panel";
import { money } from "../../lib/finance";
import { accounts, knownNetWorth } from "../../server/accounts/queries";
import { database } from "../../server/db/connection";
import { currentUser } from "../../server/session";

export const dynamic = "force-dynamic";

const groups = [
  { kind: "bank", name: "Bank Accounts" },
  { kind: "credit_card", name: "Credit Cards" },
  { kind: "loan", name: "Loans" },
  { kind: "investment", name: "Investments" },
  { kind: "other", name: "Other Accounts" },
] as const;

export default async function AccountsPage() {
  const user = await currentUser();
  const list = accounts(database(), user.id);
  const hasBalances = list.some((account) => account.balance_cents !== null);
  const allBalances = list.every((account) => account.balance_cents !== null);
  return <>
    <PageHeading title="Accounts" />
    {hasBalances && <MetricGrid>
      <Metric label={allBalances ? "Net worth" : "Net worth from known balances"} value={knownNetWorth(list)} primary />
    </MetricGrid>}
    {list.length === 0 && <Panel><p>No accounts yet.</p></Panel>}
    <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,195px),1fr))] gap-3.5">
      {groups.map((group) => {
        const members = list.filter((account) => account.kind === group.kind);
        if (!members.length) return null;
        return <Panel heading={group.name} key={group.kind}>
          {members.map(({ id, name, balance_cents: balance }) => <div className="mt-3.5 flex items-center justify-between gap-3 border-t border-line pt-3" key={id}>
            <span>{name}</span><strong>{balance === null ? "Balance unavailable" : money(balance)}</strong>
          </div>)}
        </Panel>;
      })}
    </div>
  </>;
}

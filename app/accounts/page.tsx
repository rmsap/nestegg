import { Metric } from "../../components/metric";
import { PageHeading } from "../../components/page-heading";
import { money } from "../../lib/finance";
import { accounts, knownNetWorth } from "../../server/accounts/queries";

export const dynamic = "force-dynamic";

const groups = [
  { kind: "bank", name: "Bank Accounts" },
  { kind: "credit_card", name: "Credit Cards" },
  { kind: "investment", name: "Investments" },
  { kind: "other", name: "Other Accounts" },
] as const;

export default function AccountsPage() {
  const list = accounts();
  const hasBalances = list.some((account) => account.balance_cents !== null);
  const allBalances = list.every((account) => account.balance_cents !== null);
  return <>
    <PageHeading title="Accounts" />
    {hasBalances && <div className="metrics">
      <Metric label={allBalances ? "Net worth" : "Net worth from known balances"} value={knownNetWorth(list)} primary />
    </div>}
    {list.length === 0 && <section className="panel"><p>No accounts yet.</p></section>}
    <div className="account-grid">
      {groups.map((group) => {
        const members = list.filter((account) => account.kind === group.kind);
        if (!members.length) return null;
        return <section className="panel" key={group.kind}>
          <h2>{group.name}</h2>
          {members.map(({ id, name, balance_cents: balance }) => <div className="balance-row" key={id}>
            <span>{name}</span><strong>{balance === null ? "Balance unavailable" : money(balance)}</strong>
          </div>)}
        </section>;
      })}
    </div>
  </>;
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { Activity } from "../components/activity";
import { Metric } from "../components/metric";
import { PageHeading } from "../components/page-heading";
import { budgetTotals, categories, uncategorizedSpending } from "../server/budget/queries";
import { reportingMonth } from "../lib/reporting";
import { accounts, knownNetWorth } from "../server/accounts/queries";
import { transactions } from "../server/transactions/queries";

export const dynamic = "force-dynamic";

const legacyRoutes = new Map([
  ["budget", "/budget"],
  ["transactions", "/transactions"],
  ["accounts", "/accounts"],
  ["goals", "/goals"],
]);

export default async function OverviewPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { view, ...filters } = await searchParams;
  const route = typeof view === "string" ? legacyRoutes.get(view) : undefined;
  if (route) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (typeof value === "string") query.set(key, value);
    }
    redirect(query.size ? route + "?" + query.toString() : route);
  }

  const month = reportingMonth(filters.month);
  const { planned, spent } = budgetTotals(categories(month), uncategorizedSpending(month));
  const recent = transactions(month).slice(0, 5);
  const accountList = accounts();
  const hasBalances = accountList.some((account) => account.balance_cents !== null);
  const allBalances = accountList.every((account) => account.balance_cents !== null);

  return <>
    <PageHeading title="Overview" period={{ month, path: "/" }} />
    <div className="metrics">
      <Metric label="Left to spend" value={planned - spent} primary />
      <Metric label="Posted spending" value={spent} />
      {hasBalances && <Metric label={allBalances ? "Net worth" : "Net worth from known balances"}
        value={knownNetWorth(accountList)} />}
    </div>
    <section className="panel">
      <div className="section-heading">
        <h2>Recent activity</h2>
        <Link href={"/transactions?month=" + month}>All transactions</Link>
      </div>
      <Activity list={recent} />
    </section>
  </>;
}

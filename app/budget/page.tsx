import { Metric, MetricGrid } from "../../components/metric";
import { PageHeading } from "../../components/page-heading";
import { Panel } from "../../components/ui/panel";
import { reportingMonth } from "../../lib/reporting";
import Link from "next/link";
import { money } from "../../lib/finance";
import { budgetIncome, budgetTotals, categories, uncategorizedSpending } from "../../server/budget/queries";
import { CategoryList } from "./category-list";

export const dynamic = "force-dynamic";

export default async function BudgetPage({ searchParams }: {
  searchParams: Promise<{ edit?: string | string[]; notice?: string | string[]; month?: string | string[] }>;
}) {
  const { edit, notice, month: selectedMonth } = await searchParams;
  const month = reportingMonth(selectedMonth);
  const list = categories(month);
  const expectedIncome = budgetIncome(month);
  const uncategorized = uncategorizedSpending(month);
  const { planned, spent } = budgetTotals(list, uncategorized);

  return <>
    <PageHeading title="Budget" period={{ month, path: "/budget" }} />
    {typeof notice === "string" && <p className="mb-4 rounded-lg bg-[#e8efe3] px-2.5 py-1.5 text-sm" role="status">{notice}</p>}
    <MetricGrid>
      <Metric label="Remaining" value={planned - spent} primary />
      <Metric label="Expected income" value={expectedIncome} />
      <Metric label="Planned savings" value={expectedIncome - planned} />
    </MetricGrid>
    {uncategorized !== 0 && <Panel className="mb-4" heading="Uncategorized" headingAside={<strong>{money(uncategorized)}</strong>}>
      <Link href={`/transactions?month=${month}&category=Uncategorized`}>Review transactions</Link>
    </Panel>}
    <CategoryList key={month} list={list} editing={edit === "1"} month={month} />
  </>;
}

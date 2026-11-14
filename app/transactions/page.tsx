import { Activity } from "../../components/activity";
import { PageHeading } from "../../components/page-heading";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Panel } from "../../components/ui/panel";
import { income, transfer, uncategorized } from "../../lib/finance";
import { categories } from "../../server/budget/queries";
import { reportingMonth } from "../../lib/reporting";
import { transactions } from "../../server/transactions/queries";

export const dynamic = "force-dynamic";

export default async function TransactionsPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; category?: string | string[]; month?: string | string[] }>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const selected = typeof params.category === "string" ? params.category : "";
  const search = query.trim().toLowerCase();
  const month = reportingMonth(params.month);
  const list = categories(month);
  const categoryChoices = list.map(({ id, name }) => ({ id, name }));
  const filtered = transactions(month).filter((item) =>
    (!selected || item.category === selected) &&
    `${item.merchant} ${item.account}`.toLowerCase().includes(search)
  );

  return <>
    <PageHeading title="Transactions" period={{ month, path: "/transactions", filters: { q: query, category: selected } }} />
    <Panel>
      <form className="mt-3 flex flex-wrap items-end gap-2.5 [&>label]:min-w-0 [&>label]:flex-[1_1_140px]" action="/transactions">
        <input type="hidden" name="month" value={month} />
        <Field label="Search"><input name="q" type="search" defaultValue={query} placeholder="Merchant or account" /></Field>
        <Field label="Category">
          <select name="category" defaultValue={selected}>
            <option value="">All categories</option>
            {[...new Set([...list.map((category) => category.name), uncategorized, income, transfer])].map((name) =>
              <option key={name}>{name}</option>)}
          </select>
        </Field>
        <Button type="submit" variant="primary">Filter</Button>
      </form>
      <div className="mt-4"><Activity list={filtered} categoryChoices={categoryChoices} /></div>
    </Panel>
  </>;
}

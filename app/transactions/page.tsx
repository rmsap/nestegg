import { Activity } from "../../components/activity";
import { PageHeading } from "../../components/page-heading";
import { income, transfer, uncategorized } from "../../lib/finance";
import { categories } from "../../server/budget/queries";
import { reportingMonth } from "../../lib/reporting";
import { transactions } from "../../server/transactions/queries";
import { CategoryChip } from "./category-chip";

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
    <section className="panel">
      <form className="fields" action="/transactions">
        <input type="hidden" name="month" value={month} />
        <label>Search<input name="q" type="search" defaultValue={query} placeholder="Merchant or account" /></label>
        <label>Category<select name="category" defaultValue={selected}>
          <option value="">All categories</option>
          {[...new Set([...list.map((category) => category.name), uncategorized, income, transfer])].map((name) =>
            <option key={name}>{name}</option>)}
        </select></label>
        <button className="primary">Filter</button>
      </form>
      <Activity list={filtered} renderCategory={(transaction) =>
        transaction.kind === "expense"
          ? <CategoryChip transactionId={transaction.id} merchant={transaction.merchant}
              category={transaction.category} categoryId={transaction.category_id} choices={categoryChoices} />
          : <span className="category-chip">{transaction.category}</span>
      } />
    </section>
  </>;
}

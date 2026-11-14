import { TransactionRow, type CategoryChoice } from "../app/transactions/transaction-row";
import type { Transaction } from "../server/transactions/queries";

export function Activity({ list, categoryChoices }: {
  list: Transaction[];
  categoryChoices?: CategoryChoice[];
}) {
  const hasLeadingColumn = Boolean(categoryChoices) || list.some((transaction) => transaction.memo);

  const columns = hasLeadingColumn
    ? "grid-cols-[var(--review-width)_var(--activity-columns)]"
    : "grid-cols-(--activity-columns)";
  return <div className={`grid gap-x-(--activity-gap) [--activity-gap:14px] [--review-width:28px] pointer-coarse:[--review-width:44px] [--activity-columns:minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.25fr)_auto] compact:[--activity-columns:minmax(0,1fr)_minmax(0,42%)] compact:[--activity-gap:8px] ${columns}`}>
    {list.length === 0 && <p className="col-span-full text-sm text-muted">No matching transactions.</p>}
    {list.map((transaction) => <TransactionRow key={transaction.id}
      transaction={transaction} categoryChoices={categoryChoices} hasLeadingColumn={hasLeadingColumn} />)}
  </div>;
}

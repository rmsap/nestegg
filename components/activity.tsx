import { TransactionRow, type CategoryChoice } from "../app/transactions/transaction-row";
import type { GoalChoice } from "../server/goals/goals";
import type { Transaction } from "../server/transactions/queries";

export function Activity({ list, categoryChoices, goalChoices }: {
  list: Transaction[];
  categoryChoices?: CategoryChoice[];
  goalChoices?: GoalChoice[];
}) {
  const hasLeadingColumn = Boolean(categoryChoices) || list.some((transaction) => transaction.memo);

  const columns = hasLeadingColumn
    ? "grid-cols-[var(--review-width)_var(--activity-columns)]"
    : "grid-cols-(--activity-columns)";
  return <div className={`grid gap-x-(--activity-gap) [--activity-gap:14px] [--review-width:28px] pointer-coarse:[--review-width:44px] [--activity-columns:minmax(0,2fr)_minmax(0,1.6fr)_minmax(0,1.25fr)_auto] compact:[--activity-columns:minmax(0,1fr)_minmax(0,42%)] compact:[--activity-gap:8px] ${columns}`}>
    {list.length === 0 && <p className="col-span-full text-sm text-muted">No matching transactions.</p>}
    {list.map((transaction) => {
      const canSpend = transaction.kind === "expense" && !transaction.pending && transaction.amount_cents < 0;
      const choices = goalChoices?.filter(({ accountId }) =>
        canSpend && (transaction.account_kind === "credit_card" || accountId === transaction.account_id));
      return <TransactionRow key={transaction.id} transaction={transaction} categoryChoices={categoryChoices}
        goalChoices={choices} hasLeadingColumn={hasLeadingColumn} />;
    })}
  </div>;
}

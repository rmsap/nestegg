import { TransactionRow, type CategoryChoice } from "../app/transactions/transaction-row";
import type { Transaction } from "../server/transactions/queries";

export function Activity({ list, categoryChoices }: {
  list: Transaction[];
  categoryChoices?: CategoryChoice[];
}) {
  const hasLeadingColumn = Boolean(categoryChoices) || list.some((transaction) => transaction.memo);

  return <div className={hasLeadingColumn ? "activity activity-with-review" : "activity"}>
    {list.length === 0 && <p className="muted">No matching transactions.</p>}
    {list.map((transaction) => <TransactionRow key={transaction.id}
      transaction={transaction} categoryChoices={categoryChoices} hasLeadingColumn={hasLeadingColumn} />)}
  </div>;
}

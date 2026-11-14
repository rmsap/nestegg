import type { Transaction } from "../server/transactions/queries";
import { money } from "../lib/finance";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export function Activity({ list, renderCategory }: {
  list: Transaction[];
  renderCategory?: (transaction: Transaction) => React.ReactNode;
}) {
  return <div className="activity">
    {list.length === 0 && <p className="muted">No matching transactions.</p>}
    {list.map((transaction) => <div className="activity-row" key={transaction.id}>
      <div><strong>{transaction.merchant}</strong>
        <p className="muted">{dateFormat.format(new Date(transaction.date))} · {transaction.account}</p></div>
      <div>{renderCategory ? renderCategory(transaction) : <span>{transaction.category}</span>}
        <p className="muted">{transaction.pending ? "Pending" : transaction.reviewed ? "Reviewed" : "Needs review"}</p></div>
      <strong className="amount">{money(transaction.amount_cents)}</strong>
    </div>)}
  </div>;
}

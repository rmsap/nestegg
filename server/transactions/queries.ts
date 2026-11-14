import { database } from "../db/connection";

export type Transaction = {
  id: number; date: string; merchant: string; account: string; amount_cents: number;
  category_id: number | null; category: string; kind: string; pending: number; reviewed: number;
  memo: string | null;
};

export function transactions(month: string) {
  const rows = database().prepare(`
    SELECT t.id, t.date, t.merchant, a.name AS account, t.amount_cents,
      t.category_id, t.kind, t.pending, t.reviewed, t.memo,
      CASE t.kind
        WHEN 'expense' THEN COALESCE(c.name, 'Uncategorized')
        WHEN 'income' THEN 'Income'
        ELSE 'Transfer'
      END AS category
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.date BETWEEN ? AND ? ORDER BY t.date DESC, t.id ASC
  `).all(month + "-01", month + "-31") as Transaction[];
  // SQLite rows have a null prototype. Client component props need plain objects.
  return rows.map((row) => ({ ...row }));
}

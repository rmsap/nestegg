import type { DatabaseSync } from "node:sqlite";

export type Transaction = {
  id: number; date: string; merchant: string; account: string; amount_cents: number;
  category_id: number | null; category: string; kind: string; pending: number; reviewed: number;
  memo: string | null;
  account_id: number; account_kind: string;
  goal_name: string | null;
};

export function transactions(db: DatabaseSync, userId: number, month: string) {
  const rows = db.prepare(`
    SELECT t.id, t.date, t.merchant, a.name AS account, t.amount_cents,
      t.category_id, t.kind, t.pending, t.reviewed, t.memo, a.id AS account_id, a.kind AS account_kind,
      g.name AS goal_name,
      CASE t.kind
        WHEN 'expense' THEN COALESCE(c.name, 'Uncategorized')
        WHEN 'income' THEN 'Income'
        ELSE 'Transfer'
      END AS category
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON c.id = t.category_id AND c.user_id = a.user_id
    LEFT JOIN goal_purchases p ON p.transaction_id = t.id
    LEFT JOIN goals g ON g.id = p.goal_id AND g.user_id = a.user_id
    WHERE a.user_id = ? AND t.removed_at IS NULL AND t.date BETWEEN ? AND ? ORDER BY t.date DESC, t.id ASC
  `).all(userId, month + "-01", month + "-31") as Transaction[];
  // SQLite rows have a null prototype. Client component props need plain objects.
  return rows.map((row) => ({ ...row }));
}

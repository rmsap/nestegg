import { database } from "../db/connection";

export type Transaction = {
  id: number; date: string; merchant: string; account: string; amount_cents: number;
  category_id: number | null; category: string; kind: string; pending: number; reviewed: number;
};

export function transactions(month: string) {
  return database().prepare(`
    SELECT t.*, a.name AS account,
      CASE t.kind
        WHEN 'expense' THEN COALESCE(c.name, 'Uncategorized')
        WHEN 'income' THEN 'Income'
        ELSE 'Transfer'
      END AS category
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    LEFT JOIN categories c ON t.category_id = c.id
    WHERE t.removed_at IS NULL AND t.date BETWEEN ? AND ? ORDER BY t.date DESC, t.id ASC
  `).all(month + "-01", month + "-31") as Transaction[];
}

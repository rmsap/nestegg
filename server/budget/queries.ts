import { database } from "../db/connection";

export type Category = { id: number; name: string; limit_cents: number; spent: number; activity: number };

export function categories(month: string) {
  return database().prepare(`
    SELECT c.id, c.name, COALESCE(l.limit_cents, 0) AS limit_cents,
      COALESCE(SUM(CASE WHEN t.pending = 0 THEN -t.amount_cents END), 0) AS spent,
      (SELECT COUNT(*) FROM transactions WHERE category_id = c.id) AS activity
    FROM categories c
    LEFT JOIN budget_limits l ON l.category_id = c.id AND l.month = ?
    LEFT JOIN transactions t ON t.category_id = c.id AND t.kind = 'expense' AND t.date BETWEEN ? AND ?
    GROUP BY c.id ORDER BY c.id
  `).all(month, month + "-01", month + "-31") as Category[];
}

export function budgetIncome(month: string) {
  return Number(database().prepare("SELECT expected_income_cents FROM budget_months WHERE month = ?")
    .get(month)?.expected_income_cents ?? 0);
}

export function uncategorizedSpending(month: string) {
  return Number(database().prepare(`
    SELECT COALESCE(SUM(-amount_cents), 0) AS spent
    FROM transactions
    WHERE kind = 'expense' AND category_id IS NULL AND pending = 0 AND date BETWEEN ? AND ?
  `).get(month + "-01", month + "-31")?.spent ?? 0);
}

export function budgetTotals(list: Category[], uncategorized: number) {
  return {
    spent: list.reduce((total, category) => total + category.spent, uncategorized),
    planned: list.reduce((total, category) => total + category.limit_cents, 0),
  };
}

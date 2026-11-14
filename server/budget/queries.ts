import type { DatabaseSync } from "node:sqlite";

export type Category = { id: number; name: string; limit_cents: number; spent: number; activity: number };

export function categories(db: DatabaseSync, userId: number, month: string) {
  return db.prepare(`
    SELECT c.id, c.name, COALESCE(l.limit_cents, 0) AS limit_cents,
      COALESCE(SUM(CASE WHEN t.pending = 0 THEN -t.amount_cents END), 0) AS spent,
      (SELECT COUNT(*) FROM transactions WHERE category_id = c.id AND account_id IN (SELECT id FROM accounts WHERE user_id = c.user_id)) AS activity
    FROM categories c
    LEFT JOIN budget_limits l ON l.category_id = c.id AND l.user_id = c.user_id AND l.month = ?
    LEFT JOIN transactions t ON t.category_id = c.id AND t.kind = 'expense' AND t.removed_at IS NULL AND t.date BETWEEN ? AND ?
      AND t.account_id IN (SELECT id FROM accounts WHERE user_id = c.user_id)
    WHERE c.user_id = ?
    GROUP BY c.id ORDER BY c.id
  `).all(month, month + "-01", month + "-31", userId).map((row) => ({ ...row })) as Category[];
}

export function budgetIncome(db: DatabaseSync, userId: number, month: string) {
  return Number(db.prepare("SELECT expected_income_cents FROM budget_months WHERE user_id = ? AND month = ?")
    .get(userId, month)?.expected_income_cents ?? 0);
}

export function uncategorizedSpending(db: DatabaseSync, userId: number, month: string) {
  return Number(db.prepare(`
    SELECT COALESCE(SUM(-t.amount_cents), 0) AS spent
    FROM transactions t JOIN accounts a ON a.id = t.account_id
    WHERE a.user_id = ? AND t.kind = 'expense' AND t.category_id IS NULL AND t.pending = 0 AND t.removed_at IS NULL
      AND t.date BETWEEN ? AND ?
  `).get(userId, month + "-01", month + "-31")?.spent ?? 0);
}

export function budgetTotals(list: Category[], uncategorized: number) {
  return {
    spent: list.reduce((total, category) => total + category.spent, uncategorized),
    planned: list.reduce((total, category) => total + category.limit_cents, 0),
  };
}

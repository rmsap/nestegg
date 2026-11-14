import { database } from "../db/connection";

export function updateCategory(transactionId: number, categoryId: number | null) {
  const result = database().prepare(`
    UPDATE transactions SET category_id = ?
    WHERE id = ? AND kind = 'expense'
      AND (? IS NULL OR EXISTS (SELECT 1 FROM categories WHERE id = ?))
  `).run(categoryId, transactionId, categoryId, categoryId);
  return result.changes > 0;
}


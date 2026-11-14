import type { DatabaseSync } from "node:sqlite";

export function saveReview(db: DatabaseSync, userId: number, transactionId: number, { categoryId, memo }: {
  categoryId?: number | null;
  memo?: string | null;
}) {
  // Omitted fields keep their current value. Explicit null clears the field.
  const result = db.prepare(`
    UPDATE transactions
    SET reviewed = 1,
        category_id = CASE WHEN $setCategory THEN $category ELSE category_id END,
        memo = CASE WHEN $setMemo THEN $memo ELSE memo END
    WHERE id = $id
      AND account_id IN (SELECT id FROM accounts WHERE user_id = $user)
      AND (NOT $setCategory OR (
        kind = 'expense'
        AND ($category IS NULL OR EXISTS (SELECT 1 FROM categories WHERE id = $category AND user_id = $user))
      ))
  `).run({
    $id: transactionId,
    $user: userId,
    $setCategory: Number(categoryId !== undefined),
    $category: categoryId ?? null,
    $setMemo: Number(memo !== undefined),
    $memo: memo ?? null,
  });
  return result.changes > 0;
}

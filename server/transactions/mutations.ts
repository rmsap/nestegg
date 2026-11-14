import { database } from "../db/connection";

export function saveReview(transactionId: number, { categoryId, memo }: {
  categoryId?: number | null;
  memo?: string | null;
}) {
  // Omitted fields keep their current value. Explicit null clears the field.
  const result = database().prepare(`
    UPDATE transactions
    SET reviewed = 1,
        category_id = CASE WHEN $setCategory THEN $category ELSE category_id END,
        memo = CASE WHEN $setMemo THEN $memo ELSE memo END
    WHERE id = $id
      AND (NOT $setCategory OR (
        kind = 'expense'
        AND ($category IS NULL OR EXISTS (SELECT 1 FROM categories WHERE id = $category))
      ))
  `).run({
    $id: transactionId,
    $setCategory: Number(categoryId !== undefined),
    $category: categoryId ?? null,
    $setMemo: Number(memo !== undefined),
    $memo: memo ?? null,
  });
  return result.changes > 0;
}


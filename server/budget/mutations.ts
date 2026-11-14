import type { DatabaseSync } from "node:sqlite";

export function insertCategory(db: DatabaseSync, userId: number, name: string, month: string, limit: number) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare("INSERT INTO categories (user_id, name) VALUES (?, ?) ON CONFLICT(user_id, name) DO NOTHING")
      .run(userId, name);
    if (result.changes) {
      db.prepare("INSERT INTO budget_months (user_id, month) VALUES (?, ?) ON CONFLICT DO NOTHING").run(userId, month);
      db.prepare("INSERT INTO budget_limits (user_id, month, category_id, limit_cents) VALUES (?, ?, ?, ?)")
        .run(userId, month, result.lastInsertRowid, limit);
    }
    db.exec("COMMIT");
    return result.changes > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateLimits(db: DatabaseSync, userId: number, month: string, updates: { id: number; limit: number }[]) {
  const update = db.prepare(`
    INSERT INTO budget_limits (user_id, month, category_id, limit_cents)
    SELECT user_id, ?, id, ? FROM categories WHERE id = ? AND user_id = ?
    ON CONFLICT(user_id, month, category_id) DO UPDATE SET limit_cents = excluded.limit_cents
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO budget_months (user_id, month) VALUES (?, ?) ON CONFLICT DO NOTHING").run(userId, month);
    for (const entry of updates) update.run(month, entry.limit, entry.id, userId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function removeCategory(db: DatabaseSync, userId: number, categoryId: number, replacement: number) {
  let result: "deleted" | "missing" | "replacement-required" = "deleted";
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT id FROM categories WHERE id = ? AND user_id = ?");
    const hasActivity = db.prepare("SELECT 1 FROM transactions WHERE category_id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?) LIMIT 1");
    if (!existing.get(categoryId, userId)) {
      result = "missing";
    } else if (hasActivity.get(categoryId, userId) && (replacement === categoryId || !existing.get(replacement, userId))) {
      result = "replacement-required";
    } else {
      db.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ? AND account_id IN (SELECT id FROM accounts WHERE user_id = ?)")
        .run(replacement, categoryId, userId);
      db.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").run(categoryId, userId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return result;
}

import { database } from "../db/connection";

export function insertCategory(name: string, month: string, limit: number) {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = db.prepare("INSERT INTO categories (name) VALUES (?) ON CONFLICT(name) DO NOTHING")
      .run(name);
    if (result.changes) {
      db.prepare("INSERT INTO budget_months (month) VALUES (?) ON CONFLICT DO NOTHING").run(month);
      db.prepare("INSERT INTO budget_limits VALUES (?, ?, ?)").run(month, result.lastInsertRowid, limit);
    }
    db.exec("COMMIT");
    return result.changes > 0;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function updateLimits(month: string, updates: { id: number; limit: number }[]) {
  const db = database();
  const update = db.prepare(`
    INSERT INTO budget_limits (month, category_id, limit_cents)
    SELECT ?, id, ? FROM categories WHERE id = ?
    ON CONFLICT(month, category_id) DO UPDATE SET limit_cents = excluded.limit_cents
  `);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT INTO budget_months (month) VALUES (?) ON CONFLICT DO NOTHING").run(month);
    for (const entry of updates) update.run(month, entry.limit, entry.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function removeCategory(categoryId: number, replacement: number) {
  const db = database();
  let result: "deleted" | "missing" | "replacement-required" = "deleted";
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT id FROM categories WHERE id = ?");
    const hasActivity = db.prepare("SELECT 1 FROM transactions WHERE category_id = ? LIMIT 1");
    if (!existing.get(categoryId)) {
      result = "missing";
    } else if (hasActivity.get(categoryId) && (replacement === categoryId || !existing.get(replacement))) {
      result = "replacement-required";
    } else {
      db.prepare("UPDATE transactions SET category_id = ? WHERE category_id = ?").run(replacement, categoryId);
      db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return result;
}

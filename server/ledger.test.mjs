import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { accounts, knownNetWorth } from "./accounts/queries.ts";
import { insertCategory, removeCategory, updateCategories } from "./budget/mutations.ts";
import { budgetIncome, budgetTotals, categories, uncategorizedSpending } from "./budget/queries.ts";
import { initialize } from "./db/migrations.ts";
import { saveReview } from "./transactions/mutations.ts";
import { transactions } from "./transactions/queries.ts";
import { setUserAppearance, userAppearance, userById } from "./users/users.ts";

const month = "2026-11";

function ledger(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`
    INSERT INTO accounts (id, user_id, name, kind, class, balance_cents) VALUES
      (1, 1, 'Checking', 'bank', 'asset', 120000),
      (2, 1, 'Card', 'credit_card', 'liability', 20000),
      (3, 1, 'Savings', 'bank', 'asset', NULL);
  `);
  insertCategory(db, 1, "Food", month, 5000, "#123456");
  insertCategory(db, 1, "Shopping", month, 3000, "#654321");
  const [food, shopping] = categories(db, 1, month).map(({ id }) => id);
  const insert = db.prepare(`
    INSERT INTO transactions (id, date, merchant, account_id, amount_cents, category_id, kind, pending, removed_at)
    VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
  `);
  insert.run(1, "2026-11-30", "Market", -2000, food, "expense", 0, null);
  insert.run(2, "2026-11-30", "Hold", -900, food, "expense", 1, null);
  insert.run(3, "2026-11-29", "Removed", -3000, food, "expense", 0, "2026-12-01");
  insert.run(4, "2026-10-31", "Last month", -1000, food, "expense", 0, null);
  insert.run(5, "2026-11-01", "Other", -400, null, "expense", 0, null);
  insert.run(6, "2026-11-01", "Payroll", 10000, null, "income", 0, null);
  insert.run(7, "2026-11-02", "Card payment", -9000, null, "transfer", 0, null);
  insert.run(8, "2026-11-02", "Pending tip", -500, null, "expense", 1, null);
  insert.run(9, "2026-11-02", "Refund", 300, food, "expense", 0, null);
  db.prepare("UPDATE budget_months SET expected_income_cents = ? WHERE user_id = 1 AND month = ?").run(10000, month);
  return { db, food, shopping };
}

test("monthly budget totals count posted expenses and refunds, excluding income, transfers, holds and removed rows", (t) => {
  const { db, food } = ledger(t);
  const list = categories(db, 1, month);
  assert.deepEqual(list[0], { id: food, name: "Food", color: "#123456", limit_cents: 5000, spent: 1700, activity: 5 });
  assert.equal(budgetIncome(db, 1, month), 10000);
  assert.equal(budgetIncome(db, 1, "2026-10"), 0);
  assert.equal(uncategorizedSpending(db, 1, month), 400);
  assert.deepEqual(budgetTotals(list, uncategorizedSpending(db, 1, month)), { spent: 2100, planned: 8000 });
});

test("category edits persist the color across months while keeping limits period-specific", (t) => {
  const { db, food } = ledger(t);
  assert.equal(insertCategory(db, 1, "Food", "2026-12", 100, "#000000"), false);
  assert.equal(categories(db, 1, "2026-12")[0].limit_cents, 0);
  updateCategories(db, 1, "2026-12", [{ id: food, limit: 7000, color: "#abcdef" }]);
  updateCategories(db, 1, "2026-12", [{ id: food, limit: 7500, color: "#abcdef" }]);
  assert.equal(categories(db, 1, "2026-12")[0].limit_cents, 7500);
  const saved = categories(db, 1, month)[0];
  assert.equal(saved.limit_cents, 5000);
  assert.equal(saved.color, "#abcdef");
});

test("deleting a category requires a valid replacement for its activity and removes all its limits", (t) => {
  const { db, food, shopping } = ledger(t);
  updateCategories(db, 1, "2026-12", [{ id: food, limit: 7000, color: "#123456" }]);
  assert.equal(removeCategory(db, 1, food, food), "replacement-required");
  assert.equal(removeCategory(db, 1, food, 0), "replacement-required");
  assert.equal(removeCategory(db, 1, food, shopping), "deleted");
  assert.equal(removeCategory(db, 1, food, shopping), "missing");
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM budget_limits WHERE category_id = ?").get(food).total, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM transactions WHERE category_id = ?").get(shopping).total, 5);
});

test("monthly ledger returns plain objects, keeps pending rows and has stable ordering and labels", (t) => {
  const { db } = ledger(t);
  const list = transactions(db, 1, month);
  assert.deepEqual(list.map(({ id }) => id), [1, 2, 7, 8, 9, 5, 6]);
  assert.deepEqual(list.map(({ category }) => category), ["Food", "Food", "Transfer", "Uncategorized", "Food", "Uncategorized", "Income"]);
  assert.ok(list.every((row) => Object.getPrototypeOf(row) === Object.prototype));
  assert.equal(list[1].pending, 1);
  assert.equal(list[1].account, "Checking");
});

test("review marks a transaction reviewed, preserves omitted fields and clears explicit nulls", (t) => {
  const { db, shopping } = ledger(t);
  const first = () => transactions(db, 1, month)[0];
  assert.equal(saveReview(db, 1, 1, { categoryId: 999, memo: "Invalid" }), false);
  assert.equal(first().reviewed, 0);
  assert.equal(saveReview(db, 1, 1, { categoryId: shopping, memo: "Split receipt" }), true);
  assert.equal(saveReview(db, 1, 1, {}), true);
  assert.equal(first().reviewed, 1);
  assert.equal(first().memo, "Split receipt");
  assert.equal(first().category, "Shopping");
  assert.equal(saveReview(db, 1, 1, { categoryId: null, memo: null }), true);
  assert.equal(first().memo, null);
  assert.equal(first().category, "Uncategorized");
  assert.equal(saveReview(db, 1, 6, { categoryId: shopping }), false);
  assert.equal(saveReview(db, 1, 6, { memo: "Payday" }), true);
});

test("known net worth subtracts liabilities and leaves unknown balances unavailable", (t) => {
  const { db } = ledger(t);
  const list = accounts(db, 1);
  assert.deepEqual(list.map(({ balance_cents }) => balance_cents), [120000, 20000, null]);
  assert.equal(knownNetWorth(list), 100000);
  assert.equal(knownNetWorth([]), 0);
});

test("appearance defaults and saved preferences are read back for the selected user", (t) => {
  const { db } = ledger(t);
  assert.deepEqual(userAppearance(db, 1), { color: "#245e49", mode: "system" });
  setUserAppearance(db, 1, "#aabbcc", "dark");
  assert.deepEqual(userAppearance(db, 1), { color: "#aabbcc", mode: "dark" });
  assert.equal(userById(db, 1).primary_color, "#aabbcc");
  assert.equal(userById(db, 999), undefined);
});

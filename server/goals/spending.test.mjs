import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { initialize, migrations } from "../db/migrations.ts";
import { changeGoalState, fundingAccounts, insertGoal, listGoals, setGoalCashBuffer } from "./goals.ts";
import { spendFromGoal } from "./spending.ts";

function setup(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`
    INSERT INTO users (id, username) VALUES (2, 'other');
    INSERT INTO accounts (id, user_id, name, kind, class, balance_cents) VALUES
      (1, 1, 'Savings', 'bank', 'asset', 100000), (2, 1, 'Card', 'credit_card', 'liability', 0),
      (3, 1, 'Checking', 'bank', 'asset', 100000), (4, 2, 'Other card', 'credit_card', 'liability', 0);
    INSERT INTO categories (id, user_id, name) VALUES (1, 1, 'Travel');
  `);
  const insert = db.prepare(`
    INSERT INTO transactions (id, date, merchant, account_id, amount_cents, kind, pending, category_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const entry = (id, account, amount, kind = "expense", day = "01", pending = 0) => {
    insert.run(id, "2026-11-" + day, "Transaction " + id, account, amount, kind, pending, kind === "expense" && account !== 4 ? 1 : null);
  };
  const balance = (amount) => db.prepare("UPDATE accounts SET balance_cents = ? WHERE id = 1").run(amount);
  const goal = () => listGoals(db, 1)[0];
  const funding = () => fundingAccounts(db, 1, 1)[0];
  return { db, entry, balance, goal, funding };
}

test("one-time goals count card expenses immediately and release only the unused reservation when closed", (t) => {
  const { db, entry, balance, goal, funding } = setup(t);
  insertGoal(db, 1, { name: "Vacation", target_cents: 100000, account_id: 1, funding_mode: "one-time" });
  const id = goal().id;
  changeGoalState(db, 1, id, "spending");
  entry(1, 2, -60000);
  entry(2, 2, -20000);
  entry(3, 4, -500);
  entry(4, 2, -500, "expense", "01", 1);
  assert.throws(() => spendFromGoal(db, 1, id, 3), /posted expense/);
  assert.throws(() => spendFromGoal(db, 1, id, 4), /posted expense/);
  spendFromGoal(db, 1, id, 1);
  spendFromGoal(db, 1, id, 1);
  spendFromGoal(db, 1, id, 2);
  assert.equal(goal().spent_cents, 80000);
  assert.equal(goal().saved_cents, 20000);
  assert.equal(funding().reserved, 20000);
  assert.equal(db.prepare("SELECT category_id FROM transactions WHERE id = 1").get().category_id, 1);
  changeGoalState(db, 1, id, "closed");
  assert.equal(goal().state, "closed");
  assert.equal(funding().reserved, 0);
  assert.equal(funding().available, 100000);
  entry(5, 1, -70000, "transfer", "02");
  balance(30000);
  setGoalCashBuffer(db, 1, 1, 0);
  assert.equal(goal().spent_cents, 80000);
  assert.equal(funding().available, 30000);
});

test("refillable goals deduct card and debit purchases immediately and can refill normally", (t) => {
  const { db, entry, balance, goal, funding } = setup(t);
  insertGoal(db, 1, { name: "Emergency", target_cents: 80000, account_id: 1 });
  const id = goal().id;
  entry(1, 1, -50000);
  balance(50000);
  spendFromGoal(db, 1, id, 1);
  assert.equal(goal().saved_cents, 30000);
  assert.equal(goal().spent_cents, 50000);
  setGoalCashBuffer(db, 1, 1, 0);
  assert.equal(goal().saved_cents, 50000);
  entry(2, 2, -10000);
  spendFromGoal(db, 1, id, 2);
  assert.equal(goal().saved_cents, 40000);
  assert.equal(funding().reserved, 40000);
  balance(90000);
  setGoalCashBuffer(db, 1, 1, 0);
  assert.equal(goal().saved_cents, 80000);
  assert.equal(goal().state, "funding");
  assert.equal(funding().reserved, 80000);
  assert.equal(goal().spent_cents, 60000);
});

test("the goals migration upgrades an existing account and transaction in one step", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec("PRAGMA foreign_keys = OFF");
  for (const migration of migrations.filter(({ version }) => version <= 11)) db.exec(migration.sql);
  db.exec(`
    PRAGMA user_version = 11;
    INSERT INTO accounts (id, user_id, name, kind, class, balance_cents) VALUES
      (1, 1, 'Savings', 'bank', 'asset', 100000), (2, 1, 'Card', 'credit_card', 'liability', 0);
    INSERT INTO transactions (id, date, merchant, account_id, amount_cents, kind) VALUES
      (1, '2026-11-01', 'Hotel', 2, -30000, 'expense'),
      (2, '2026-11-02', 'Payment', 1, -10000, 'transfer');
  `);

  initialize(db);
  assert.deepEqual(migrations.filter(({ version }) => version > 11).map(({ version }) => version), [12]);
  assert.equal(db.prepare("PRAGMA user_version").get().user_version, 12);
  assert.equal(fundingAccounts(db, 1, 1)[0].goal_buffer_cents, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 2);
  insertGoal(db, 1, { name: "Trip", target_cents: 70000, account_id: 1 });
  spendFromGoal(db, 1, listGoals(db, 1)[0].id, 1);
  assert.equal(listGoals(db, 1)[0].saved_cents, 40000);
  assert.equal(listGoals(db, 1)[0].spent_cents, 30000);
  assert.equal(fundingAccounts(db, 1, 1)[0].reserved, 40000);
});

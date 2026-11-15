import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { initialize } from "../db/migrations.ts";
import { deleteUser } from "../users/users.ts";
import { editGoal, fundingAccounts, goalChoices, insertGoal, listGoals, releaseGoalFunds, setGoalCashBuffer } from "./goals.ts";

test("reopening the current schema preserves existing goal amounts and ownership", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`
    INSERT INTO users (id, username) VALUES (2, 'second');
    INSERT INTO accounts (id, user_id, name, kind, class, balance_cents) VALUES
      (1, 1, 'Savings', 'bank', 'asset', 50000), (2, 2, 'Savings', 'bank', 'asset', 100000),
      (3, 1, 'Travel savings', 'bank', 'asset', 20000);
    INSERT INTO goals (user_id, account_id, name, target_cents, saved_cents)
      VALUES (1, 1, 'Trip', 50000, 12550);
  `);

  initialize(db);
  insertGoal(db, 2, { name: "Rainy day", target_cents: 100000, account_id: 2 });
  assert.deepEqual(listGoals(db, 1).map((row) => ({ ...row })), [
    { id: 1, name: "Trip", target_cents: 50000, saved_cents: 12550, account_id: 1,
      funding_mode: "refillable", state: "funding", spent_cents: 0 },
  ]);
  assert.deepEqual(listGoals(db, 2).map(({ name }) => name), ["Rainy day"]);
  assert.deepEqual(goalChoices(db, 2).map(({ name }) => name), ["Rainy day"]);
  assert.throws(() => editGoal(db, 1, 1, "one-time", 2), /open bank account/);
  assert.equal(listGoals(db, 1)[0].funding_mode, "refillable");
  editGoal(db, 1, 1, "one-time", 3);
  const [edited] = listGoals(db, 1);
  assert.equal(edited.account_id, 3);
  assert.equal(edited.funding_mode, "one-time");

  deleteUser(db, 2);
  assert.deepEqual(listGoals(db, 2), []);
  assert.equal(listGoals(db, 1).length, 1);
});

test("creating goals uses each account's available funds and preserves buffers and existing reservations", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec(`
    INSERT INTO users (id, username) VALUES (2, 'second');
    INSERT INTO accounts (id, user_id, name, kind, class, balance_cents) VALUES
      (1, 1, 'Savings', 'bank', 'asset', 300000),
      (2, 1, 'Rewards', 'credit_card', 'liability', 200000),
      (3, 2, 'Other savings', 'bank', 'asset', 200000),
      (4, 1, 'Vacation savings', 'bank', 'asset', 50000);
  `);
  setGoalCashBuffer(db, 1, 1, 50000);
  const goal = { name: "Trip", target_cents: 200000, account_id: 1 };
  insertGoal(db, 1, goal);
  insertGoal(db, 1, { ...goal, name: "Emergency fund" });
  insertGoal(db, 1, { ...goal, name: "Vacation", account_id: 4 });
  assert.throws(() => insertGoal(db, 1, { ...goal, account_id: 3 }), /open bank account/);
  assert.throws(() => setGoalCashBuffer(db, 1, 3, 0), /open bank account/);
  assert.throws(() => editGoal(db, 1, 2, "refillable", 2), /open bank account/);
  assert.throws(() => editGoal(db, 1, 2, "refillable", 3), /open bank account/);
  assert.throws(() => editGoal(db, 2, 2, "refillable", 3), /goal could not be found/);
  const saved = () => listGoals(db, 1).map(({ saved_cents }) => saved_cents);
  assert.deepEqual(saved(), [200000, 50000, 50000]);
  assert.equal(fundingAccounts(db, 1, 1)[0].available, 0);
  assert.throws(() => releaseGoalFunds(db, 1, 1, 1), /exceeds the funds you can release/);

  db.exec("UPDATE accounts SET balance_cents = 220000 WHERE id = 1");
  assert.equal(fundingAccounts(db, 1, 1)[0].shortfall, 30000);
  releaseGoalFunds(db, 1, 1, 30000);
  assert.equal(fundingAccounts(db, 1, 1)[0].shortfall, 0);
  assert.deepEqual(saved(), [170000, 50000, 50000]);
  assert.equal(fundingAccounts(db, 1, 1)[0].balance_cents, 220000);

  db.exec("UPDATE accounts SET balance_cents = 300000 WHERE id = 1");
  setGoalCashBuffer(db, 1, 1, 0);
  assert.deepEqual(saved(), [200000, 100000, 50000]);
});

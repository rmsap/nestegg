import type { DatabaseSync } from "node:sqlite";
import { findGoal, GoalFundingError, inGoalTransaction } from "./goals.ts";

export function spendFromGoal(db: DatabaseSync, userId: number, goalId: number, transactionId: number) {
  inGoalTransaction(db, () => {
    const goal = findGoal(db, userId, goalId);
    if (goal.state === "closed" || goal.account_id === null) throw new GoalFundingError("Choose an open goal with a funding account.");
    const transaction = db.prepare(`
      SELECT t.account_id, t.amount_cents, a.kind AS account_kind,
        a.balance_cents IS NOT NULL AND COALESCE(a.balance_as_of, '') >= COALESCE(r.started_at, '') AS balance_current
      FROM transactions t JOIN accounts a ON a.id = t.account_id
      JOIN accounts funding ON funding.id = ? AND funding.user_id = a.user_id AND funding.currency = a.currency
      LEFT JOIN sync_runs r ON r.id = t.first_seen_sync_run_id
      WHERE t.id = ? AND a.user_id = ? AND t.kind = 'expense' AND t.amount_cents < 0
        AND t.pending = 0 AND t.removed_at IS NULL
    `).get(goal.account_id, transactionId, userId);
    const cardPurchase = transaction?.account_kind === "credit_card";
    if (!transaction || (!cardPurchase && transaction.account_id !== goal.account_id)) {
      throw new GoalFundingError("Choose a posted expense from the goal’s bank account or a credit card.");
    }
    const existing = db.prepare("SELECT goal_id FROM goal_purchases WHERE transaction_id = ?").get(transactionId);
    if (existing?.goal_id === goalId) return;
    if (existing) throw new GoalFundingError("This transaction is already covered by a goal.");
    if (!cardPurchase && !transaction.balance_current) {
      throw new GoalFundingError("Sync the funding account’s balance before recording this expense.");
    }
    const amount = -Number(transaction.amount_cents);
    if (amount > goal.saved_cents) throw new GoalFundingError("This goal does not have enough saved for the full purchase.");

    db.prepare("INSERT INTO goal_purchases (transaction_id, goal_id, amount_cents) VALUES (?, ?, ?)")
      .run(transactionId, goalId, amount);
    db.prepare(`
      UPDATE goals SET saved_cents = saved_cents - ?,
        state = CASE WHEN funding_mode = 'one-time' THEN 'spending' ELSE state END WHERE id = ?
    `).run(amount, goalId);
  });
}

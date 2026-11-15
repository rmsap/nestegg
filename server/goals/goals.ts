import type { DatabaseSync } from "node:sqlite";

export type Goal = {
  id: number;
  name: string;
  target_cents: number;
  saved_cents: number;
  account_id: number | null;
  funding_mode: "one-time" | "refillable";
  state: "funding" | "spending" | "closed";
  spent_cents: number;
};

type FundingAccountRow = {
  id: number;
  name: string;
  last_four: string | null;
  balance_cents: number | null;
  goal_buffer_cents: number;
  eligible: 0 | 1;
  reserved: number;
};

export class GoalFundingError extends Error {}

export function listGoals(db: DatabaseSync, userId: number) {
  return db.prepare(`
    SELECT g.id, g.name, g.target_cents, g.saved_cents, g.account_id, g.funding_mode, g.state,
      COALESCE(SUM(p.amount_cents), 0) AS spent_cents
    FROM goals g LEFT JOIN goal_purchases p ON p.goal_id = g.id
    WHERE g.user_id = ?
    GROUP BY g.id ORDER BY g.id
  `).all(userId) as Goal[];
}

export function findGoal(db: DatabaseSync, userId: number, id: number) {
  const goal = db.prepare(`
    SELECT account_id, saved_cents, funding_mode, state FROM goals WHERE user_id = ? AND id = ?
  `).get(userId, id) as Pick<Goal, "account_id" | "saved_cents" | "funding_mode" | "state"> | undefined;
  if (!goal) throw new GoalFundingError("That goal could not be found.");
  return goal;
}

export type GoalChoice = { id: number; name: string; accountId: number; saved: number };

export function goalChoices(db: DatabaseSync, userId: number) {
  const rows = db.prepare(`
    SELECT id, name, account_id AS accountId, saved_cents AS saved FROM goals
    WHERE user_id = ? AND account_id IS NOT NULL AND state <> 'closed' ORDER BY id
  `).all(userId) as GoalChoice[];
  return rows.map((row) => ({ ...row }));
}

export function fundingAccounts(db: DatabaseSync, userId: number, accountId?: number) {
  const rows = db.prepare(`
    SELECT a.id, a.name, a.last_four, a.balance_cents, a.goal_buffer_cents,
      a.kind = 'bank' AND a.class = 'asset' AND a.closed_at IS NULL AS eligible,
      COALESCE(SUM(g.saved_cents), 0) AS reserved
    FROM accounts a
    LEFT JOIN goals g ON g.account_id = a.id AND g.user_id = a.user_id
    WHERE a.user_id = ? ${accountId === undefined ? "" : "AND a.id = ?"}
    GROUP BY a.id
    HAVING eligible = 1 OR COUNT(g.id) > 0
    ORDER BY a.name, a.id
  `).all(...(accountId === undefined ? [userId] : [userId, accountId])) as FundingAccountRow[];
  return rows.map((row) => {
    const balance = row.eligible ? row.balance_cents : null;
    return {
      ...row,
      available: balance === null ? null : Math.max(0, balance - row.reserved - row.goal_buffer_cents),
      shortfall: balance === null ? null : Math.max(0, row.reserved - Math.max(0, balance)),
    };
  });
}

export type FundingAccount = ReturnType<typeof fundingAccounts>[number];

export function inGoalTransaction(db: DatabaseSync, work: () => void) {
  db.exec("BEGIN IMMEDIATE");
  try {
    work();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function requireFundingAccount(db: DatabaseSync, userId: number, accountId: number) {
  const [account] = fundingAccounts(db, userId, accountId);
  if (!account?.eligible) throw new GoalFundingError("Choose an open bank account.");
  return account;
}

export function insertGoal(db: DatabaseSync, userId: number, goal: {
  name: string; target_cents: number; account_id: number; funding_mode?: Goal["funding_mode"];
}) {
  inGoalTransaction(db, () => {
    requireFundingAccount(db, userId, goal.account_id);
    db.prepare("INSERT INTO goals (user_id, name, target_cents, account_id, funding_mode) VALUES (?, ?, ?, ?, ?)")
      .run(userId, goal.name, goal.target_cents, goal.account_id, goal.funding_mode ?? "refillable");
    allocateGoalFunds(db, userId, goal.account_id);
  });
}

export function editGoal(db: DatabaseSync, userId: number, goalId: number, mode: Goal["funding_mode"], accountId?: number) {
  inGoalTransaction(db, () => {
    const goal = findGoal(db, userId, goalId);
    if (goal.state === "closed") throw new GoalFundingError("This goal is closed.");

    const nextAccount = accountId ?? goal.account_id;
    const moved = nextAccount !== goal.account_id;
    if (accountId !== undefined && moved) {
      const account = requireFundingAccount(db, userId, accountId);
      if (goal.saved_cents > (account.available ?? 0)) {
        throw new GoalFundingError("The new account needs enough available funds to cover this goal.");
      }
    }
    const state = mode === "refillable" ? "funding" : goal.state;
    db.prepare("UPDATE goals SET account_id = ?, funding_mode = ?, state = ? WHERE id = ? AND user_id = ?")
      .run(nextAccount, mode, state, goalId, userId);
    if (nextAccount !== null && (moved || mode === "refillable")) allocateGoalFunds(db, userId, nextAccount);
    if (moved && goal.account_id !== null) allocateGoalFunds(db, userId, goal.account_id);
  });
}

export function releasableFunds(goal: Pick<Goal, "saved_cents">, account?: FundingAccount) {
  return Math.min(goal.saved_cents, account?.shortfall ?? goal.saved_cents);
}

export function releaseGoalFunds(db: DatabaseSync, userId: number, goalId: number, amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new GoalFundingError("Enter an amount greater than zero.");
  inGoalTransaction(db, () => {
    const goal = findGoal(db, userId, goalId);
    const account = goal.account_id === null ? undefined : fundingAccounts(db, userId, goal.account_id)[0];
    if (amount > releasableFunds(goal, account)) throw new GoalFundingError("That amount exceeds the funds you can release.");
    db.prepare("UPDATE goals SET saved_cents = saved_cents - ? WHERE id = ? AND user_id = ?")
      .run(amount, goalId, userId);
  });
}

export function setGoalCashBuffer(db: DatabaseSync, userId: number, accountId: number, amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0) throw new GoalFundingError("Enter a valid cash buffer.");
  inGoalTransaction(db, () => {
    requireFundingAccount(db, userId, accountId);
    db.prepare("UPDATE accounts SET goal_buffer_cents = ? WHERE id = ? AND user_id = ?").run(amount, accountId, userId);
    allocateGoalFunds(db, userId, accountId);
  });
}

export function changeGoalState(db: DatabaseSync, userId: number, goalId: number, state: "spending" | "closed") {
  inGoalTransaction(db, () => {
    const goal = findGoal(db, userId, goalId);
    if (goal.funding_mode !== "one-time") throw new GoalFundingError("Only one-time goals have a spending phase.");
    if (goal.state === state) return;
    if (goal.state === "closed") throw new GoalFundingError("This goal is closed.");
    db.prepare("UPDATE goals SET state = ?, saved_cents = CASE WHEN ? = 'closed' THEN 0 ELSE saved_cents END WHERE id = ?")
      .run(state, state, goalId);
    if (state === "closed" && goal.account_id !== null) allocateGoalFunds(db, userId, goal.account_id);
  });
}

// Run inside the same write transaction as the balance or goal change.
export function allocateGoalFunds(db: DatabaseSync, userId: number, accountId: number) {
  const goals = db.prepare(`
    SELECT id, target_cents - saved_cents AS needed FROM goals
    WHERE user_id = ? AND account_id = ? AND state = 'funding' AND saved_cents < target_cents ORDER BY id
  `).all(userId, accountId) as { id: number; needed: number }[];
  if (!goals.length) return;

  const [account] = fundingAccounts(db, userId, accountId);
  let remaining = account?.available ?? 0;
  if (!remaining) return;

  // Fund goals whose remaining target is below their share, then divide the rest evenly.
  let unfinished = goals.length;
  for (const { needed } of [...goals].sort((a, b) => a.needed - b.needed)) {
    if (needed > Math.floor(remaining / unfinished)) break;
    remaining -= needed;
    unfinished--;
  }
  const share = unfinished ? Math.floor(remaining / unfinished) : Infinity;
  let extraCents = unfinished ? remaining % unfinished : 0;
  const save = db.prepare("UPDATE goals SET saved_cents = saved_cents + ? WHERE id = ? AND user_id = ?");
  for (const { id, needed } of goals) {
    let amount = Math.min(needed, share);
    if (needed > share && extraCents > 0) {
      amount++;
      extraCents--;
    }
    if (amount) save.run(amount, id, userId);
  }
}

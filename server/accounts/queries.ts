import type { DatabaseSync } from "node:sqlite";

export type Account = {
  id: number;
  name: string;
  kind: "bank" | "credit_card" | "investment" | "loan" | "other";
  class: "asset" | "liability";
  balance_cents: number | null;
};

export function accounts(db: DatabaseSync, userId: number) {
  return db.prepare("SELECT id, name, kind, class, balance_cents FROM accounts WHERE user_id = ? ORDER BY id")
    .all(userId).map((row) => ({ ...row })) as Account[];
}

export function knownNetWorth(list: Account[]) {
  return list.reduce((total, account) => {
    const balance = account.balance_cents ?? 0;
    return total + (account.class === "liability" ? -balance : balance);
  }, 0);
}

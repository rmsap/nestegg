import { database } from "../db/connection";

export type Account = {
  id: number;
  name: string;
  kind: "bank" | "credit_card" | "investment" | "loan" | "other";
  class: "asset" | "liability";
  balance_cents: number | null;
};

export function accounts() {
  return database().prepare("SELECT id, name, kind, class, balance_cents FROM accounts ORDER BY id").all() as Account[];
}

export function knownNetWorth(list: Account[]) {
  return list.reduce((total, account) => {
    const balance = account.balance_cents ?? 0;
    return total + (account.class === "liability" ? -balance : balance);
  }, 0);
}

import type { DatabaseSync } from "node:sqlite";
import type { TransactionProvider } from "./transaction-provider";

export async function syncTransactions(db: DatabaseSync, provider: TransactionProvider) {
  // Complete network work before taking a write lock.
  const accounts = await provider.fetchAccounts();
  db.exec("BEGIN IMMEDIATE");
  try {
    const upsertAccount = db.prepare(`
      INSERT INTO accounts (name, kind, balance_cents, provider, external_id)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(provider, external_id) DO UPDATE SET
        name = excluded.name, kind = excluded.kind,
        balance_cents = COALESCE(excluded.balance_cents, accounts.balance_cents)
      RETURNING id
    `);
    const upsertTransaction = db.prepare(`
      INSERT INTO transactions (date, merchant, account_id, amount_cents, kind, pending, external_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, external_id) DO UPDATE SET
        date = excluded.date, merchant = excluded.merchant,
        amount_cents = excluded.amount_cents, kind = excluded.kind, pending = excluded.pending
      WHERE transactions.pending = 1 OR excluded.pending = 0
    `);
    let transactions = 0;
    for (const account of accounts) {
      if (!account.externalId || account.currency !== "USD" ||
        (account.balanceCents !== null && !Number.isSafeInteger(account.balanceCents))) {
        throw new Error("Invalid provider account or unsupported currency");
      }
      const local = upsertAccount.get(account.name, account.kind, account.balanceCents, provider.id, account.externalId);
      const accountId = Number(local?.id);
      for (const entry of account.transactions) {
        const date = new Date(entry.date + "T00:00:00Z");
        if (!entry.externalId || !Number.isSafeInteger(entry.amountCents) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 10) !== entry.date) {
          throw new Error("Invalid provider transaction");
        }
        upsertTransaction.run(entry.date, entry.description, accountId, entry.amountCents,
          entry.kind, Number(entry.pending), entry.externalId);
        transactions++;
      }
    }
    db.exec("COMMIT");
    return { accounts: accounts.length, transactions };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

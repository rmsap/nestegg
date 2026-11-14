import type { DatabaseSync } from "node:sqlite";
import type { TransactionProvider } from "./transaction-provider";

export async function syncTransactions(db: DatabaseSync, connectionId: number, provider: TransactionProvider) {
  // Complete network work before taking a write lock.
  const accounts = await provider.fetchAccounts();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (!db.prepare("SELECT 1 FROM connections WHERE id = ?").get(connectionId)) throw new Error("Unknown connection");
    const now = new Date().toISOString();
    const upsertAccount = db.prepare(`
      INSERT INTO accounts (name, kind, class, currency, balance_cents, balance_as_of, connection_id, external_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, external_id) DO UPDATE SET
        name = excluded.name, kind = excluded.kind, class = excluded.class, currency = excluded.currency,
        balance_cents = COALESCE(excluded.balance_cents, accounts.balance_cents),
        balance_as_of = COALESCE(excluded.balance_as_of, accounts.balance_as_of)
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
      const local = upsertAccount.get(account.name, account.kind,
        account.kind === "credit_card" || account.kind === "loan" ? "liability" : "asset", account.currency,
        account.balanceCents, account.balanceCents === null ? null : now, connectionId, account.externalId);
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

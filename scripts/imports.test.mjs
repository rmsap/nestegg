import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { initialize } from "../server/db/migrations.ts";
import { syncTransactions } from "../server/imports/sync.ts";
import { tellerSandbox } from "../server/imports/teller-sandbox.ts";

test("a repeat sync updates provider facts and preserves a reviewed category", async (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  const purchase = {
    externalId: "purchase-1", date: "2026-11-08", description: "Market",
    amountCents: -2500, kind: "expense", pending: true,
  };
  const entries = [
    purchase,
    { ...purchase, externalId: "payment-1", kind: "transfer", pending: false },
    { ...purchase, externalId: "purchase-2", amountCents: -500, pending: false },
  ];
  const provider = {
    id: "fixture",
    async fetchAccounts() {
      return [{
        externalId: "account-1", name: "Checking", kind: "bank", currency: "USD",
        balanceCents: 4200, transactions: entries,
      }];
    },
  };
  const postedSpending = () => db.prepare(
    "SELECT SUM(-amount_cents) AS spent FROM transactions WHERE kind = 'expense' AND pending = 0"
  ).get().spent;

  await syncTransactions(db, provider);
  assert.equal(postedSpending(), 500);
  db.exec("INSERT INTO categories (id, name) VALUES (1, 'Groceries')");
  db.exec("UPDATE transactions SET category_id = 1, reviewed = 1 WHERE external_id = 'purchase-1'");
  purchase.pending = false;
  purchase.date = "2026-11-09";
  purchase.amountCents = -2599;
  await syncTransactions(db, provider);
  await syncTransactions(db, provider);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM accounts").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 3);
  assert.equal(postedSpending(), 3099);
  const updated = db.prepare("SELECT date, pending, category_id, reviewed FROM transactions WHERE external_id = 'purchase-1'").get();
  assert.deepEqual({ ...updated }, { date: "2026-11-09", pending: 0, category_id: 1, reviewed: 1 });

  purchase.pending = true;
  await syncTransactions(db, provider);
  assert.equal(postedSpending(), 3099);
  entries.push({ ...purchase, externalId: "bad", date: "2026-02-30" });
  entries[2].amountCents = -700;
  await assert.rejects(syncTransactions(db, provider), /Invalid provider transaction/);
  assert.equal(postedSpending(), 3099);
  entries.pop();
  await syncTransactions(db, provider);
  assert.equal(postedSpending(), 3299);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count, 3);
});

test("Teller adapter normalizes expenses, refunds and card payments", async () => {
  const account = {
    id: "acc_1", name: "Checking", type: "depository", currency: "USD",
    links: { transactions: true, balances: true },
  };
  const purchase = {
    account_id: account.id, id: "txn_1", date: "2026-11-08", amount: "12.09",
    description: "Market", type: "card_payment", status: "posted",
  };
  const request = async (url) => {
    const { pathname } = new URL(url);
    if (pathname === "/accounts") return Response.json([account]);
    if (pathname.endsWith("/balances")) {
      return Response.json({ account_id: account.id, ledger: null, available: "50.25" });
    }
    assert.equal(pathname, "/accounts/acc_1/transactions");
    return Response.json([
      purchase,
      { ...purchase, id: "txn_2", type: "card_purchase", status: "pending" },
      { ...purchase, id: "txn_3", type: "refund", amount: "-12.09" },
    ]);
  };
  const [normalized] = await tellerSandbox("test_token_fixture", request).fetchAccounts();
  assert.equal(normalized.balanceCents, 5025);
  assert.deepEqual(normalized.transactions.map(({ kind, amountCents, pending }) => [kind, amountCents, pending]), [
    ["transfer", -1209, false],
    ["expense", -1209, true],
    ["expense", 1209, false],
  ]);
});

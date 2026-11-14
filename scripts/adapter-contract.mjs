import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createConnection, setConnectionEnabled } from "../server/connections/mutations.ts";
import { initialize } from "../server/db/migrations.ts";
import { setProviderSettings } from "../server/imports/provider-settings.ts";
import { syncConnection } from "../server/imports/sync.ts";

const day = (date) => date.toISOString().slice(0, 10);
const KINDS = ["bank", "credit_card", "investment", "loan", "other"];
const TXN_KINDS = ["expense", "income", "transfer"];

export function checkAdapter(test, assert, { adapter, settings, request, payload, now }) {
  const name = adapter.key;
  const ctx = (nonce) => ({ settings, request, now, nonce });
  const window = { start: day(new Date(now.getTime() - 60 * 86_400_000)), end: day(now) };
  const connect = async () => {
    await adapter.beginConnect(ctx("nonce"));
    return adapter.completeConnect(ctx("nonce"), payload);
  };

  test(`${name} contract: key matches a providers row`, (t) => {
    const db = new DatabaseSync(":memory:");
    t.after(() => db.close());
    initialize(db);
    assert.ok(typeof adapter.key === "string" && adapter.key.length > 0);
    assert.ok(db.prepare("SELECT 1 FROM providers WHERE key = ?").get(adapter.key));
  });

  test(`${name} contract: settings fields are well formed`, () => {
    const names = adapter.settings.map((field) => field.name);
    assert.equal(new Set(names).size, names.length);
    for (const field of adapter.settings) {
      assert.ok(["text", "secret", "file", "choice"].includes(field.kind));
      if (field.kind === "choice") assert.ok(Array.isArray(field.choices) && field.choices.length > 0);
    }
  });

  test(`${name} contract: beginConnect returns a known shape`, async () => {
    const start = await adapter.beginConnect(ctx("nonce"));
    assert.ok(["form", "widget", "redirect"].includes(start.kind));
    if (start.kind === "form") assert.ok(Array.isArray(start.fields));
    if (start.kind === "widget") assert.ok(typeof start.widget === "string" && start.params && typeof start.params === "object");
    if (start.kind === "redirect") assert.ok(typeof start.url === "string" && start.url.length > 0);
  });

  test(`${name} contract: completeConnect returns a credential and a label`, async () => {
    const result = await connect();
    assert.ok(typeof result.credential === "string" && result.credential.length > 0);
    assert.ok(typeof result.label === "string" && result.label.length >= 1 && result.label.length <= 80);
  });

  test(`${name} contract: fetchAccounts returns normalized accounts`, async () => {
    const { credential } = await connect();
    const accounts = await adapter.fetchAccounts(ctx(), credential, window);
    assert.ok(Array.isArray(accounts));
    const accountIds = new Set();
    for (const account of accounts) {
      assert.ok(typeof account.externalId === "string" && account.externalId);
      assert.ok(!accountIds.has(account.externalId));
      accountIds.add(account.externalId);
      assert.ok(KINDS.includes(account.kind));
      assert.match(account.currency, /^[A-Z]{3}$/);
      assert.ok(account.balanceCents === null || Number.isSafeInteger(account.balanceCents));
      const ids = new Set();
      for (const entry of account.transactions) {
        assert.ok(typeof entry.externalId === "string" && entry.externalId);
        assert.ok(!ids.has(entry.externalId));
        ids.add(entry.externalId);
        assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(new Date(entry.date + "T00:00:00Z").toISOString().slice(0, 10), entry.date);
        assert.ok(entry.date >= window.start && entry.date <= window.end);
        assert.ok(Number.isSafeInteger(entry.amountCents));
        assert.ok(TXN_KINDS.includes(entry.kind));
        assert.equal(typeof entry.pending, "boolean");
        if (entry.replaces !== undefined) assert.ok(typeof entry.replaces === "string" && entry.replaces.length > 0 && entry.replaces !== entry.externalId);
      }
    }
  });

  test(`${name} contract: fetchAccounts is stable across calls`, async () => {
    const { credential } = await connect();
    const ids = (accounts) => accounts.map((account) => [account.externalId, account.transactions.map((entry) => entry.externalId)]);
    const first = await adapter.fetchAccounts(ctx(), credential, window);
    const second = await adapter.fetchAccounts(ctx(), credential, window);
    assert.deepEqual(ids(second), ids(first));
  });

  test(`${name} contract: a full sync succeeds and a second one adds nothing`, async (t) => {
    const db = new DatabaseSync(":memory:");
    t.after(() => db.close());
    initialize(db);
    const key = randomBytes(32);
    if (Object.keys(settings).length) setProviderSettings(db, key, adapter, settings);
    const { credential, label } = await connect();
    const id = createConnection(db, key, { provider: adapter.key, label, credential });
    setConnectionEnabled(db, id, true);
    const options = { now, request };
    const first = await syncConnection(db, key, id, adapter, options);
    assert.ok(first.accounts >= 0);
    const second = await syncConnection(db, key, id, adapter, options);
    assert.deepEqual([second.added, second.updated, second.removed], [0, 0, 0]);
  });
}

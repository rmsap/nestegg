import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createConnection, setConnectionEnabled } from "../server/connections/mutations.ts";
import { initialize } from "../server/db/migrations.ts";
import { plaid } from "../server/imports/plaid.ts";
import { syncConnection } from "../server/imports/sync.ts";
import { ProviderError } from "../server/imports/transaction-provider.ts";
import { checkAdapter } from "./adapter-contract.mjs";

const T0 = new Date("2026-11-10T12:00:00.000Z");
const settings = { clientId: "cid_abc123", secret: "sec_xyz789", environment: "sandbox" };
const ACCESS = "access-sandbox-tok1";
const FREE = "Free text from Plaid that must never be echoed";
const window = { start: "2026-09-11", end: "2026-11-10" };
const credential = JSON.stringify({ accessToken: ACCESS, itemId: "item1", institution: "First Platypus" });
const ctx = (request, extra = {}) => ({ settings, request, now: T0, ...extra });

const acct = (id, type, extra = {}) => ({
  account_id: id, name: id + " name", official_name: null, mask: "1234", type, subtype: null,
  balances: { current: 100.5, available: 90, iso_currency_code: "USD" }, ...extra,
});
const ACCOUNTS = [acct("checking", "depository"), acct("card", "credit")];
const txn = (id, extra = {}) => ({
  transaction_id: id, account_id: "checking", date: "2026-11-05", name: "Market", merchant_name: null, amount: 12.34,
  pending: false, pending_transaction_id: null, personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" }, ...extra,
});
const bulk = (count) => Array.from({ length: count }, (_, i) => txn("t" + i, { amount: i + 1 }));

function transport({ accounts = ACCOUNTS, txns = bulk(600), overrides = {} } = {}) {
  const calls = [];
  const routes = {
    "/link/token/create": () => ({ json: { link_token: "link-sandbox-1" } }),
    "/item/public_token/exchange": () => ({ json: { access_token: ACCESS, item_id: "item1" } }),
    "/transactions/get": (body) => {
      const { offset, count } = body.options;
      return { json: { accounts, transactions: txns.slice(offset, offset + count), total_transactions: txns.length } };
    },
    "/item/remove": () => ({ json: {} }),
    ...overrides,
  };
  const request = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body, path: new URL(url).pathname });
    const out = await routes[new URL(url).pathname](body, calls);
    return new Response(out.text ?? JSON.stringify(out.json), { status: out.status ?? 200 });
  };
  return { request, calls };
}

const fetchWith = async (txns, accounts = ACCOUNTS) => plaid.fetchAccounts(ctx(transport({ txns, accounts }).request), credential, window);
const only = async (txns, accounts) => (await fetchWith(txns, accounts)).flatMap((account) => account.transactions);

checkAdapter(test, assert, {
  adapter: plaid, settings, request: transport().request, payload: { publicToken: "public-sandbox-1", institutionName: "First Platypus" }, now: T0,
});

test("plaid requests go to the environment host with the three headers and no secrets in the url or body", async () => {
  for (const [environment, host] of [["sandbox", "https://sandbox.plaid.com"], ["production", "https://production.plaid.com"]]) {
    const { request, calls } = transport();
    const options = { ...settings, environment };
    await plaid.beginConnect({ settings: options, request, now: T0 });
    await plaid.completeConnect({ settings: options, request, now: T0 }, { publicToken: "public-1" });
    await plaid.fetchAccounts({ settings: options, request, now: T0 }, credential, window);
    await plaid.disconnect({ settings: options, request, now: T0 }, credential);
    assert.equal(calls.length, 5);
    for (const call of calls) {
      assert.ok(call.url.startsWith(host + "/"));
      assert.deepEqual(call.init.headers, {
        "Content-Type": "application/json", "PLAID-CLIENT-ID": settings.clientId, "PLAID-SECRET": settings.secret, "Plaid-Version": "2020-09-14",
      });
      assert.equal(call.init.method, "POST");
      assert.equal(call.init.redirect, "error");
      assert.equal(call.init.cache, "no-store");
      assert.ok(call.init.signal instanceof AbortSignal);
      for (const value of [settings.clientId, settings.secret]) assert.ok(!call.url.includes(value) && !call.init.body.includes(value));
    }
  }
  for (const missing of ["clientId", "secret", "environment"]) {
    const { request, calls } = transport();
    await assert.rejects(plaid.beginConnect({ settings: { ...settings, [missing]: "" }, request, now: T0 }),
      { name: "ProviderError", kind: "invalid", message: "Plaid is not configured" });
    assert.equal(calls.length, 0);
  }
  await assert.rejects(plaid.beginConnect({ settings: { ...settings, environment: "development" }, request: transport().request, now: T0 }), { message: "Plaid is not configured" });
});

test("beginConnect sends products for a new link and the access token for a repair", async () => {
  const fresh = transport();
  const start = await plaid.beginConnect(ctx(fresh.request));
  assert.deepEqual(start, { kind: "widget", widget: "plaid-link", params: { linkToken: "link-sandbox-1", mode: "create" } });
  assert.equal(fresh.calls[0].path, "/link/token/create");
  assert.deepEqual(fresh.calls[0].body, {
    client_name: "Nestegg", language: "en", country_codes: ["US"], user: { client_user_id: "nestegg-owner" },
    products: ["transactions"], transactions: { days_requested: 730 },
  });
  const redirected = transport();
  await plaid.beginConnect({ settings: { ...settings, redirectUri: "https://nest.example/oauth" }, request: redirected.request, now: T0 });
  assert.equal(redirected.calls[0].body.redirect_uri, "https://nest.example/oauth");
  assert.ok(!("redirect_uri" in fresh.calls[0].body));
  const repair = transport();
  const update = await plaid.beginConnect(ctx(repair.request), credential);
  assert.equal(update.params.mode, "update");
  assert.equal(repair.calls[0].body.access_token, ACCESS);
  assert.ok(!("products" in repair.calls[0].body) && !("transactions" in repair.calls[0].body));
});

test("completeConnect exchanges the public token on a new link and makes no request in update mode", async () => {
  const fresh = transport();
  const result = await plaid.completeConnect(ctx(fresh.request), { publicToken: "public-1", institutionName: "  First Platypus  " });
  assert.deepEqual(fresh.calls.map((call) => [call.path, call.body]), [["/item/public_token/exchange", { public_token: "public-1" }]]);
  assert.deepEqual(JSON.parse(result.credential), { accessToken: ACCESS, itemId: "item1", institution: "First Platypus" });
  assert.equal(result.label, "First Platypus");
  assert.equal((await plaid.completeConnect(ctx(transport().request), { publicToken: "p" })).label, "Plaid");
  assert.equal((await plaid.completeConnect(ctx(transport().request), { publicToken: "p", institutionName: "x".repeat(200) })).label.length, 80);
  const repair = transport();
  const again = await plaid.completeConnect(ctx(repair.request), { publicToken: "public-2", institutionName: "Other" }, credential);
  assert.equal(repair.calls.length, 0);
  assert.deepEqual(again, { credential, label: "First Platypus" });
  for (const bad of [null, "x", [], {}, { publicToken: 5 }, { publicToken: "" }, { publicToken: "p", institutionName: 5 }, { publicToken: "p", extra: 1 }]) {
    await assert.rejects(plaid.completeConnect(ctx(transport().request), bad), { kind: "invalid" });
  }
});

test("amounts become integer cents with our sign without float arithmetic", async () => {
  const amounts = [12.34, -2500, 0.1, 1234.5, -19.99, 0, 1.005, 0.29, 4.35, 9007199254740.99];
  const rows = await only(amounts.map((amount, i) => txn("a" + i, { amount })));
  assert.deepEqual(rows.map((row) => row.amountCents), [-1234, 250000, -10, -123450, 1999, 0, -100, -29, -435, -900719925474099]);
  assert.ok(rows.every((row) => !Object.is(row.amountCents, -0)));
  const text = (value) => ({ "/transactions/get": () => ({ text: `{"accounts":${JSON.stringify(ACCOUNTS)},"transactions":[${JSON.stringify(txn("n")).replace('"amount":12.34', '"amount":' + value)}],"total_transactions":1}` }) });
  for (const bad of ["1e999", "-1e999", "1e300", "null", '"12.34"']) {
    await assert.rejects(plaid.fetchAccounts(ctx(transport({ overrides: text(bad) }).request), credential, window), { kind: "invalid" });
  }
});

test("transaction kinds follow the category and the sign on each account kind", async () => {
  const on = (account_id, primary, amount) => txn(`${account_id}-${primary}-${amount}`, { account_id, amount, personal_finance_category: primary ? { primary, detailed: primary + "_X" } : null });
  const accounts = [acct("bank", "depository"), acct("card", "credit"), acct("loan", "loan"), acct("inv", "investment"), acct("misc", "other")];
  const kinds = async (primary, amount) => Object.fromEntries((await fetchWith(["bank", "card", "loan", "inv", "misc"].map((id) => on(id, primary, amount)), accounts))
    .map((account) => [account.externalId, account.transactions[0].kind]));
  const all = (kind) => ({ bank: kind, card: kind, loan: kind, inv: kind, misc: kind });
  for (const primary of ["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]) {
    assert.deepEqual(await kinds(primary, 50), all("transfer"));
    assert.deepEqual(await kinds(primary, -50), all("transfer"));
  }
  assert.deepEqual(await kinds("INCOME", 50), all("income"));
  assert.deepEqual(await kinds("INCOME", -50), all("income"));
  assert.deepEqual(await kinds("FOOD_AND_DRINK", 50), all("expense"));
  assert.deepEqual(await kinds(null, 50), all("expense"));
  assert.deepEqual(await kinds("GENERAL_MERCHANDISE", -50), { bank: "income", card: "expense", loan: "expense", inv: "income", misc: "expense" });
  const [row] = await only([txn("c", { amount: -19.99, account_id: "card" })]);
  assert.deepEqual([row.amountCents, row.kind], [1999, "expense"]);
});

test("accounts map type, mask, balance and currency, and empty accounts are still returned", async () => {
  const accounts = [
    acct("a-bank", "depository", { mask: "0001" }), acct("a-card", "credit", { mask: null, balances: { current: 500, available: 4500, iso_currency_code: "USD" } }),
    acct("a-loan", "loan"), acct("a-inv", "investment"), acct("a-brk", "brokerage"), acct("a-other", "other"), acct("a-pay", "payroll"),
    acct("a-avail", "depository", { balances: { current: null, available: 12.5, iso_currency_code: "USD" } }),
    acct("a-none", "depository", { name: null, official_name: "Official", balances: { current: null, available: null, iso_currency_code: "USD" } }),
  ];
  const result = await fetchWith([txn("t1", { account_id: "a-bank" })], accounts);
  assert.deepEqual(result.map((account) => [account.externalId, account.kind]), [
    ["a-bank", "bank"], ["a-card", "credit_card"], ["a-loan", "loan"], ["a-inv", "investment"], ["a-brk", "investment"],
    ["a-other", "other"], ["a-pay", "other"], ["a-avail", "bank"], ["a-none", "bank"],
  ]);
  const byId = Object.fromEntries(result.map((account) => [account.externalId, account]));
  assert.equal(byId["a-bank"].lastFour, "0001");
  assert.equal(byId["a-card"].lastFour, undefined);
  assert.equal(byId["a-card"].balanceCents, 50000);
  assert.equal(byId["a-avail"].balanceCents, 1250);
  assert.equal(byId["a-none"].balanceCents, null);
  assert.equal(byId["a-none"].name, "Official");
  assert.ok(result.every((account) => account.institution === "First Platypus" && account.currency === "USD"));
  assert.equal(byId["a-bank"].transactions.length, 1);
  assert.equal(byId["a-card"].transactions.length, 0);
  await assert.rejects(fetchWith([], [acct("x", "depository", { balances: { current: 1, available: 1, iso_currency_code: null } })]),
    { kind: "invalid", message: "Plaid account has no ISO currency" });
  await assert.rejects(fetchWith([txn("t1", { account_id: "ghost" })]), { kind: "invalid" });
});

test("transactions are fetched by offset in pages of 500 and capped at 60 pages", async () => {
  const { request, calls } = transport({ txns: bulk(1200) });
  const result = await plaid.fetchAccounts(ctx(request), credential, window);
  assert.deepEqual(calls.map((call) => call.body.options), [{ count: 500, offset: 0 }, { count: 500, offset: 500 }, { count: 500, offset: 1000 }]);
  assert.equal(calls[0].body.access_token, ACCESS);
  assert.deepEqual([calls[0].body.start_date, calls[0].body.end_date], [window.start, window.end]);
  assert.equal(result.flatMap((account) => account.transactions).length, 1200);
  const full = transport({ txns: bulk(30_000) });
  assert.equal((await plaid.fetchAccounts(ctx(full.request), credential, window))[0].transactions.length, 30_000);
  assert.equal(full.calls.length, 60);
  const capped = transport({ txns: bulk(30_001) });
  await assert.rejects(plaid.fetchAccounts(ctx(capped.request), credential, window), { kind: "invalid" });
  assert.equal(capped.calls.length, 60);
  const stalled = transport({ overrides: { "/transactions/get": () => ({ json: { accounts: ACCOUNTS, transactions: [], total_transactions: 5 } }) } });
  await assert.rejects(plaid.fetchAccounts(ctx(stalled.request), credential, window), { kind: "invalid" });
});

test("a pending transaction id becomes replaces and counterparty and category are carried", async () => {
  const rows = await only([
    txn("posted", { pending_transaction_id: "pending", merchant_name: "Market Co" }),
    txn("same", { pending_transaction_id: "same" }), txn("empty", { pending_transaction_id: "" }), txn("held", { pending: true }),
    txn("fallback", { personal_finance_category: { primary: "INCOME" } }), txn("bare", { personal_finance_category: null }),
  ]);
  assert.deepEqual(rows.map((row) => row.replaces), ["pending", undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual([rows[0].counterparty, rows[0].category, rows[0].description, rows[3].pending], ["Market Co", "FOOD_AND_DRINK_GROCERIES", "Market", true]);
  assert.deepEqual([rows[4].category, rows[5].category, rows[1].counterparty], ["INCOME", undefined, undefined]);
});

test("plaid errors map to provider error kinds without leaking secrets or free text", async () => {
  const cases = [
    [400, { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED" }, "auth", "Plaid: ITEM_LOGIN_REQUIRED"],
    [400, { error_type: "INVALID_INPUT", error_code: "INVALID_ACCESS_TOKEN" }, "auth", "Plaid: INVALID_ACCESS_TOKEN"],
    [400, { error_type: "ITEM_ERROR", error_code: "ITEM_NOT_FOUND" }, "auth", "Plaid: ITEM_NOT_FOUND"],
    [400, { error_type: "ITEM_ERROR", error_code: "ACCESS_NOT_GRANTED" }, "auth", "Plaid: ACCESS_NOT_GRANTED"],
    [400, { error_type: "INVALID_INPUT", error_code: "USER_PERMISSION_REVOKED" }, "auth", "Plaid: USER_PERMISSION_REVOKED"],
    [400, { error_type: "ITEM_ERROR", error_code: "INVALID_CREDENTIALS" }, "auth", "Plaid: INVALID_CREDENTIALS"],
    [429, { error_type: "RATE_LIMIT_EXCEEDED", error_code: "TRANSACTIONS_LIMIT" }, "rate_limit", "Plaid: TRANSACTIONS_LIMIT"],
    [429, null, "rate_limit", "Plaid rate limit reached"],
    [400, { error_type: "RATE_LIMIT_EXCEEDED", error_code: "RATE_LIMIT" }, "rate_limit", "Plaid: RATE_LIMIT"],
    [200, { error_type: "RATE_LIMIT_EXCEEDED", error_code: "RATE_LIMIT" }, "rate_limit", "Plaid: RATE_LIMIT"],
    [400, { error_type: "INSTITUTION_ERROR", error_code: "INSTITUTION_DOWN" }, "unavailable", "Plaid: INSTITUTION_DOWN"],
    [500, { error_type: "API_ERROR", error_code: "INTERNAL_SERVER_ERROR" }, "unavailable", "Plaid: INTERNAL_SERVER_ERROR"],
    [400, { error_type: "ITEM_ERROR", error_code: "PRODUCT_NOT_READY" }, "unavailable", "Plaid is still preparing this connection's transactions"],
    [503, null, "unavailable", "Plaid is unavailable"],
    [400, { error_type: "INVALID_INPUT", error_code: "INVALID_API_KEYS" }, "invalid", "Plaid: INVALID_API_KEYS"],
    [400, { error_type: "INVALID_REQUEST", error_code: "INVALID_FIELD" }, "invalid", "Plaid: INVALID_FIELD"],
    [400, { error_type: "INVALID_REQUEST", error_code: "has spaces and " + ACCESS }, "invalid", "Plaid rejected the request"],
    [400, null, "invalid", "Plaid rejected the request"],
  ];
  const secrets = [settings.clientId, settings.secret, ACCESS, FREE];
  for (const [status, body, kind, message] of cases) {
    const json = body && { ...body, error_message: FREE + " " + ACCESS, display_message: FREE };
    const overrides = { "/transactions/get": () => ({ status: status === 200 ? 429 : status, text: json ? JSON.stringify(json) : "" }) };
    await assert.rejects(plaid.fetchAccounts(ctx(transport({ overrides }).request), credential, window), (error) => {
      assert.ok(error instanceof ProviderError);
      assert.deepEqual([error.kind, error.message], [kind, message]);
      for (const secret of secrets) assert.ok(!error.message.includes(secret));
      return true;
    });
  }
  const html = { "/transactions/get": () => ({ status: 502, text: "<html>" + FREE + "</html>" }) };
  await assert.rejects(plaid.fetchAccounts(ctx(transport({ overrides: html }).request), credential, window), { kind: "unavailable", message: "Plaid is unavailable" });
  for (const thrown of [new TypeError("fetch failed " + settings.secret + ACCESS), new DOMException("timed out " + ACCESS, "TimeoutError")]) {
    const request = async () => { throw thrown; };
    await assert.rejects(plaid.fetchAccounts(ctx(request), credential, window), (error) => {
      assert.deepEqual([error.kind, error.message], ["unavailable", "Plaid could not be reached"]);
      return true;
    });
  }
  const malformed = { "/link/token/create": () => ({ json: { nothing: true } }) };
  await assert.rejects(plaid.beginConnect(ctx(transport({ overrides: malformed }).request)), { kind: "invalid" });
  const garbled = { "/link/token/create": () => ({ text: "not json" }) };
  await assert.rejects(plaid.beginConnect(ctx(transport({ overrides: garbled }).request)), { kind: "invalid" });
  await assert.rejects(plaid.fetchAccounts(ctx(transport().request), "not a credential", window), { kind: "invalid", message: "The Plaid credential is not valid" });
});

test("disconnect posts the access token to /item/remove", async () => {
  const { request, calls } = transport();
  await plaid.disconnect(ctx(request), credential);
  assert.deepEqual(calls.map((call) => [call.path, call.body]), [["/item/remove", { access_token: ACCESS }]]);
  const failing = { "/item/remove": () => ({ status: 400, text: JSON.stringify({ error_type: "ITEM_ERROR", error_code: "ITEM_NOT_FOUND" }) }) };
  await assert.rejects(plaid.disconnect(ctx(transport({ overrides: failing }).request), credential), { kind: "auth" });
});

function engine(t) {
  const key = randomBytes(32);
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  initialize(db);
  db.exec("INSERT INTO providers (key, name, sync_interval_minutes, min_sync_interval_minutes, lookback_days) VALUES ('fixture', 'Fixture', 360, 15, 10)");
  const id = createConnection(db, key, { provider: "fixture", label: "Fixture", credential: "tok" });
  setConnectionEnabled(db, id, true);
  const adapter = { key: "fixture", settings: [], accounts: [], async fetchAccounts() { return adapter.accounts; } };
  const sync = (days = 0) => syncConnection(db, key, id, adapter, { now: new Date(T0.getTime() + days * 86_400_000) });
  const rows = (sql, ...args) => db.prepare(sql).all(...args).map((row) => ({ ...row }));
  const set = (...transactions) => { adapter.accounts = [{ externalId: "a1", name: "Checking", kind: "bank", currency: "USD", balanceCents: 100, transactions }]; };
  return { db, sync, rows, set };
}
const row = (externalId, extra = {}) => ({ externalId, date: "2026-11-08", description: "Market", amountCents: -2500, kind: "expense", pending: false, ...extra });
const counts = (result) => [result.added, result.updated, result.removed];

test("a posted row that replaces a pending one updates it in place and keeps the user's fields", async (t) => {
  const { db, sync, rows, set } = engine(t);
  set(row("p1", { pending: true }));
  const first = await sync();
  assert.deepEqual(counts(first), [1, 0, 0]);
  db.exec("INSERT INTO categories (id, name) VALUES (1, 'Groceries')");
  db.exec("UPDATE transactions SET category_id = 1, reviewed = 1, memo = 'mine'");
  const before = rows("SELECT id, first_seen_sync_run_id FROM transactions");
  set(row("x1", { replaces: "p1", date: "2026-11-09", amountCents: -2599, counterparty: "Market Co", category: "groceries" }));
  const second = await sync(1);
  assert.deepEqual(counts(second), [0, 1, 0]);
  assert.deepEqual(rows("SELECT id, external_id, date, amount_cents, pending, counterparty, provider_category, category_id, reviewed, memo, first_seen_sync_run_id, removed_at FROM transactions"), [
    { id: before[0].id, external_id: "x1", date: "2026-11-09", amount_cents: -2599, pending: 0, counterparty: "Market Co", provider_category: "groceries",
      category_id: 1, reviewed: 1, memo: "mine", first_seen_sync_run_id: first.syncRunId, removed_at: null },
  ]);
  assert.equal(before[0].first_seen_sync_run_id, first.syncRunId);
  const replay = await sync(2);
  assert.deepEqual(counts(replay), [0, 0, 0]);
  assert.equal(rows("SELECT id FROM transactions").length, 1);
});

test("a replaced row that was soft-removed is revived under the new id", async (t) => {
  const { sync, rows, set } = engine(t);
  set(row("p1", { pending: true }));
  await sync();
  set();
  assert.deepEqual(counts(await sync(1)), [0, 0, 1]);
  set(row("x1", { replaces: "p1" }));
  assert.deepEqual(counts(await sync(2)), [0, 1, 0]);
  assert.deepEqual(rows("SELECT external_id, removed_at, pending FROM transactions"), [{ external_id: "x1", removed_at: null, pending: 0 }]);
});

test("when both ids already exist the pending row is soft-removed once", async (t) => {
  const { sync, rows, set } = engine(t);
  set(row("p1", { pending: true }), row("x1"));
  assert.deepEqual(counts(await sync()), [2, 0, 0]);
  set(row("x1", { replaces: "p1" }));
  const result = await sync(1);
  assert.deepEqual(counts(result), [0, 0, 1]);
  const state = () => rows("SELECT external_id, removed_at FROM transactions ORDER BY external_id");
  assert.deepEqual(state().map((item) => [item.external_id, item.removed_at !== null]), [["p1", true], ["x1", false]]);
  const before = state();
  assert.deepEqual(counts(await sync(2)), [0, 0, 0]);
  assert.deepEqual(state(), before);
});

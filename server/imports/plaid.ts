import { ProviderError } from "./transaction-provider.ts";
import type { ProviderAccount, ProviderAdapter, ProviderContext, ProviderTransaction } from "./transaction-provider.ts";

type Json = Record<string, unknown>;
type Credential = { accessToken: string; itemId: string; institution: string };

const HOSTS: Record<string, string> = { sandbox: "https://sandbox.plaid.com", production: "https://production.plaid.com" };
const PAGE = 500;
const MAX_PAGES = 60;
const AUTH = new Set([
  "ITEM_LOGIN_REQUIRED", "INVALID_ACCESS_TOKEN", "ITEM_NOT_FOUND", "ACCESS_NOT_GRANTED", "USER_PERMISSION_REVOKED", "INVALID_CREDENTIALS",
  "INVALID_MFA", "ITEM_LOCKED", "PASSWORD_RESET_REQUIRED", "USER_SETUP_REQUIRED",
]);
const KINDS: Record<string, ProviderAccount["kind"]> = { depository: "bank", credit: "credit_card", loan: "loan", investment: "investment", brokerage: "investment" };
const TRANSFERS = new Set(["TRANSFER_IN", "TRANSFER_OUT", "LOAN_PAYMENTS"]);

const NOT_READY = "Plaid is still preparing this connection's transactions";

// Plaid answers PRODUCT_NOT_READY for a few seconds after a new link.
export const notReadyRetry = { attempts: 5, delayMs: 3000 };

const invalid = (message: string) => new ProviderError("invalid", message);
const object = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : null);
const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

function failure(status: number, body: Json | null) {
  const type = text(body?.error_type), found = text(body?.error_code);
  const code = found && /^[A-Z0-9_]{1,64}$/.test(found) ? found : undefined;
  const said = code ? `Plaid: ${code}` : undefined;
  if (code === "PRODUCT_NOT_READY") return new ProviderError("unavailable", NOT_READY);
  if (status === 429 || type === "RATE_LIMIT_EXCEEDED") return new ProviderError("rate_limit", said ?? "Plaid rate limit reached");
  if (code && AUTH.has(code)) return new ProviderError("auth", said!);
  if (type === "INSTITUTION_ERROR" || type === "API_ERROR" || status >= 500) return new ProviderError("unavailable", said ?? "Plaid is unavailable");
  return invalid(said ?? "Plaid rejected the request");
}

async function call(ctx: ProviderContext, path: string, body: Json): Promise<Json> {
  const { clientId, secret, environment } = ctx.settings;
  if (!clientId || !secret || !environment || !HOSTS[environment]) throw invalid("Plaid is not configured");
  let response: Response;
  try {
    response = await ctx.request(HOSTS[environment] + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", "PLAID-CLIENT-ID": clientId, "PLAID-SECRET": secret, "Plaid-Version": "2020-09-14" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("unavailable", "Plaid could not be reached");
  }
  let json: Json | null = null;
  try {
    json = object(await response.json());
  } catch {}
  if (!response.ok) throw failure(response.status, json);
  if (!json) throw invalid("Plaid returned an unreadable response");
  return json;
}

async function firstPage(ctx: ProviderContext, body: Json) {
  for (let left = notReadyRetry.attempts; ; left--) {
    try {
      return await call(ctx, "/transactions/get", body);
    } catch (error) {
      if (!(error instanceof ProviderError) || error.message !== NOT_READY || left <= 0) throw error;
      await new Promise((resolve) => setTimeout(resolve, notReadyRetry.delayMs));
    }
  }
}

function credentialOf(value: string): Credential {
  try {
    const parsed = object(JSON.parse(value));
    const accessToken = text(parsed?.accessToken), itemId = text(parsed?.itemId), institution = text(parsed?.institution);
    if (accessToken && itemId && institution) return { accessToken, itemId, institution };
  } catch {}
  throw invalid("The Plaid credential is not valid");
}

// Plaid amounts are JSON numbers; formatting to two decimals keeps float arithmetic off the value. Positive is money out.
function cents(value: unknown) {
  const match = typeof value === "number" && Number.isFinite(value) ? /^(-?)(\d+)\.(\d{2})$/.exec(value.toFixed(2)) : null;
  const magnitude = match ? Number(match[2] + match[3]) : NaN;
  if (!match || !Number.isSafeInteger(magnitude)) throw invalid("Plaid returned an invalid amount");
  return match[1] ? -magnitude : magnitude;
}

const negate = (value: number) => (value === 0 ? 0 : -value);

function entry(raw: unknown, kind: ProviderAccount["kind"]): ProviderTransaction {
  const row = object(raw);
  const externalId = text(row?.transaction_id), date = text(row?.date);
  if (!row || !externalId || !date) throw invalid("Plaid returned an invalid transaction");
  const amountCents = negate(cents(row.amount));
  const primary = text(object(row.personal_finance_category)?.primary);
  const detailed = text(object(row.personal_finance_category)?.detailed);
  const pendingId = text(row.pending_transaction_id);
  const counterparty = text(row.merchant_name);
  const category = detailed ?? primary;
  const income = amountCents > 0 && (kind === "bank" || kind === "investment");
  return {
    externalId, date, description: text(row.name) ?? counterparty ?? "Transaction", amountCents,
    kind: primary && TRANSFERS.has(primary) ? "transfer" : primary === "INCOME" || income ? "income" : "expense",
    pending: row.pending === true,
    ...(counterparty ? { counterparty } : {}),
    ...(category ? { category } : {}),
    ...(pendingId && pendingId !== externalId ? { replaces: pendingId } : {}),
  };
}

function account(raw: unknown, institution: string): ProviderAccount {
  const row = object(raw), balances = object(row?.balances);
  const externalId = text(row?.account_id), name = text(row?.name) ?? text(row?.official_name);
  if (!row || !balances || !externalId || !name) throw invalid("Plaid returned an invalid account");
  const currency = text(balances.iso_currency_code);
  if (!currency) throw invalid("Plaid account has no ISO currency");
  const balance = balances.current ?? balances.available;
  const lastFour = text(row.mask);
  return {
    externalId, name, kind: KINDS[String(row.type)] ?? "other", currency, institution, transactions: [],
    balanceCents: balance === null || balance === undefined ? null : cents(balance),
    ...(lastFour ? { lastFour } : {}),
  };
}

export const plaid: ProviderAdapter = {
  key: "plaid",
  settings: [
    { name: "clientId", label: "Client ID", kind: "text", required: true },
    { name: "secret", label: "Secret", kind: "secret", required: true },
    {
      name: "environment", label: "Environment", kind: "choice", required: true,
      choices: [{ value: "sandbox", label: "Sandbox" }, { value: "production", label: "Production" }],
    },
    { name: "redirectUri", label: "OAuth redirect URI", kind: "text", required: false },
  ],
  async beginConnect(ctx, existingCredential) {
    const update = existingCredential !== undefined;
    const response = await call(ctx, "/link/token/create", {
      client_name: "Nestegg", language: "en", country_codes: ["US"], user: { client_user_id: "nestegg-owner" },
      ...(ctx.settings.redirectUri ? { redirect_uri: ctx.settings.redirectUri } : {}),
      ...(update ? { access_token: credentialOf(existingCredential).accessToken } : { products: ["transactions"], transactions: { days_requested: 730 } }),
    });
    const linkToken = text(response.link_token);
    if (!linkToken) throw invalid("Plaid returned an unreadable response");
    return { kind: "widget", widget: "plaid-link", params: { linkToken, mode: update ? "update" : "create" } };
  },
  async completeConnect(ctx, payload, existingCredential) {
    const input = object(payload);
    const publicToken = text(input?.publicToken), name = input?.institutionName;
    if (!input || !publicToken || (name !== undefined && typeof name !== "string") || Object.keys(input).some((field) => field !== "publicToken" && field !== "institutionName")) {
      throw invalid("Plaid sign-in did not return a public token");
    }
    if (existingCredential !== undefined) return { credential: existingCredential, label: credentialOf(existingCredential).institution };
    const response = await call(ctx, "/item/public_token/exchange", { public_token: publicToken });
    const accessToken = text(response.access_token), itemId = text(response.item_id);
    if (!accessToken || !itemId) throw invalid("Plaid returned an unreadable response");
    const institution = (name ?? "").trim().slice(0, 80) || "Plaid";
    return { credential: JSON.stringify({ accessToken, itemId, institution }), label: institution };
  },
  async fetchAccounts(ctx, credential, window) {
    const { accessToken, institution } = credentialOf(credential);
    let accounts = new Map<string, ProviderAccount>();
    const raw: unknown[] = [];
    for (let page = 0, total = 0; ; page++) {
      if (page >= MAX_PAGES) throw invalid("Plaid returned too many pages of transactions");
      const body = {
        access_token: accessToken, start_date: window.start, end_date: window.end, options: { count: PAGE, offset: raw.length },
      };
      const response = page === 0 ? await firstPage(ctx, body) : await call(ctx, "/transactions/get", body);
      const batch = response.transactions, listed = response.accounts;
      total = Number(response.total_transactions);
      if (!Array.isArray(batch) || !Array.isArray(listed) || !Number.isSafeInteger(total) || total < 0) throw invalid("Plaid returned an unreadable response");
      if (page === 0) accounts = new Map(listed.map((item) => account(item, institution)).map((item) => [item.externalId, item]));
      raw.push(...batch);
      if (raw.length >= total) break;
      if (!batch.length) throw invalid("Plaid returned fewer transactions than it reported");
    }
    const seen = new Set<string>();
    for (const item of raw) {
      const target = accounts.get(String(object(item)?.account_id));
      if (!target) throw invalid("Plaid returned a transaction for an unknown account");
      const row = entry(item, target.kind);
      if (seen.has(row.externalId)) continue;
      seen.add(row.externalId);
      target.transactions.push(row);
    }
    return [...accounts.values()];
  },
  async disconnect(ctx, credential) {
    await call(ctx, "/item/remove", { access_token: credentialOf(credential).accessToken });
  },
};

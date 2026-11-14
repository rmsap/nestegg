import { ProviderError } from "./transaction-provider.ts";
import type { ProviderAccount, ProviderAdapter, ProviderTransaction } from "./transaction-provider.ts";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ProviderError("invalid", "Unexpected Teller response");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new ProviderError("invalid", "Missing Teller response field");
  return value;
}

function rows(value: unknown) {
  if (!Array.isArray(value)) throw new ProviderError("invalid", "Expected a Teller response list");
  return value.map(record);
}

function cents(value: unknown) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(string(value));
  if (!match) throw new ProviderError("invalid", "Invalid Teller amount");
  const amount = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new ProviderError("invalid", "Teller amount is out of range");
  return match[1] ? -amount : amount;
}

function transaction(row: Record<string, unknown>, accountId: string): ProviderTransaction {
  if (row.account_id !== accountId || (row.status !== "pending" && row.status !== "posted")) {
    throw new ProviderError("invalid", "Invalid Teller transaction account or status");
  }
  const amountCents = -cents(row.amount);
  const type = string(row.type);
  const kind = ["transfer", "card_payment", "credit_card_payment"].includes(type)
    ? "transfer"
    : amountCents <= 0 || type === "refund" ? "expense" : "income";
  return {
    externalId: string(row.id), date: string(row.date), description: string(row.description),
    amountCents, kind, pending: row.status === "pending",
  };
}

async function failure(response: Response) {
  const { status } = response;
  if (status === 401 || status === 403) return new ProviderError("auth", "Teller rejected the credential");
  if (status === 404) {
    const code = await response.json().then((body) => record(record(body).error).code, () => null);
    if (typeof code === "string" && code.startsWith("enrollment.disconnected")) {
      return new ProviderError("auth", "Teller enrollment is disconnected");
    }
  }
  if (status === 429) return new ProviderError("rate_limit", "Teller is rate limiting requests");
  if (status >= 500) return new ProviderError("unavailable", "Teller is unavailable");
  return new ProviderError("invalid", "Teller returned HTTP " + status);
}

const unreachable = () => new ProviderError("unavailable", "Teller could not be reached");

export const teller: ProviderAdapter = {
  key: "teller",
  async fetchAccounts(token, window, request = fetch) {
    if (!/^test_token_[A-Za-z0-9_-]+$/.test(token)) {
      throw new ProviderError("auth", "A Teller Sandbox test_token_ credential is required");
    }

    async function get(path: string): Promise<unknown> {
      let response: Response;
      try {
        response = await request("https://api.teller.io" + path, {
          headers: { Authorization: "Basic " + Buffer.from(token + ":").toString("base64") },
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
          cache: "no-store",
        });
      } catch {
        throw unreachable();
      }
      if (!response.ok) throw await failure(response);
      try {
        return await response.json();
      } catch (error) {
        throw error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
          ? unreachable() : new ProviderError("invalid", "Unexpected Teller response");
      }
    }

    const result: ProviderAccount[] = [];
    for (const row of rows(await get("/accounts"))) {
      if (row.currency !== "USD") throw new ProviderError("invalid", "Only USD Teller accounts are supported");
      const externalId = string(row.id);
      const path = "/accounts/" + encodeURIComponent(externalId);
      const links = record(row.links);
      const balances = links.balances ? record(await get(path + "/balances")) : null;
      if (balances && balances.account_id !== externalId) throw new ProviderError("invalid", "Invalid Teller balance account");
      const balance = balances?.ledger ?? balances?.available ?? null;
      const query = "?start_date=" + window.start + "&end_date=" + window.end;
      const entries = links.transactions ? rows(await get(path + "/transactions" + query)) : [];
      result.push({
        externalId, name: string(row.name), currency: "USD",
        kind: row.type === "credit" ? "credit_card" : row.type === "depository" ? "bank" : "other",
        balanceCents: balance == null ? null : cents(balance),
        transactions: entries.map((entry) => transaction(entry, externalId)),
      });
    }
    return result;
  },
};

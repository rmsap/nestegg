import type { ProviderAccount, ProviderTransaction, TransactionProvider } from "./transaction-provider";

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Unexpected Teller response");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("Missing Teller response field");
  return value;
}

function rows(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Expected a Teller response list");
  return value.map(record);
}

function cents(value: unknown) {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(string(value));
  if (!match) throw new Error("Invalid Teller amount");
  const amount = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(amount)) throw new Error("Teller amount is out of range");
  return match[1] ? -amount : amount;
}

function transaction(row: Record<string, unknown>, accountId: string): ProviderTransaction {
  if (row.account_id !== accountId || (row.status !== "pending" && row.status !== "posted")) {
    throw new Error("Invalid Teller transaction account or status");
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

export function tellerSandbox(token: string, request: typeof fetch = fetch): TransactionProvider {
  if (!/^test_token_[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("A Teller Sandbox test_token_ credential is required");
  }

  async function get(path: string): Promise<unknown> {
    const response = await request("https://api.teller.io" + path, {
      headers: { Authorization: "Basic " + Buffer.from(token + ":").toString("base64") },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) throw new Error("Teller Sandbox returned HTTP " + response.status);
    return response.json();
  }

  return {
    id: "teller:sandbox",
    async fetchAccounts() {
      const result: ProviderAccount[] = [];
      for (const row of rows(await get("/accounts"))) {
        if (row.currency !== "USD") throw new Error("Only USD Teller accounts are supported");
        const externalId = string(row.id);
        const path = "/accounts/" + encodeURIComponent(externalId);
        const links = record(row.links);
        const balances = links.balances ? record(await get(path + "/balances")) : null;
        if (balances && balances.account_id !== externalId) throw new Error("Invalid Teller balance account");
        const balance = balances?.ledger ?? balances?.available ?? null;
        const entries = links.transactions ? rows(await get(path + "/transactions")) : [];
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
}

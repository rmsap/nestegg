export type ProviderTransaction = {
  externalId: string;
  date: string;
  description: string;
  // Negative is money out. Positive is money in, including refunds.
  amountCents: number;
  kind: "expense" | "income" | "transfer";
  pending: boolean;
};

export type ProviderAccount = {
  externalId: string;
  name: string;
  kind: "bank" | "credit_card" | "investment" | "loan" | "other";
  currency: "USD";
  // Credit card balances are positive when money is owed.
  balanceCents: number | null;
  institution?: string;
  lastFour?: string;
  transactions: ProviderTransaction[];
};

export type ProviderAdapter = {
  // Equals providers.key.
  key: string;
  // The window is inclusive YYYY-MM-DD dates.
  fetchAccounts(credential: string, window: { start: string; end: string }, request?: typeof fetch): Promise<ProviderAccount[]>;
};

export class ProviderError extends Error {
  kind: "auth" | "rate_limit" | "unavailable" | "invalid";
  constructor(kind: ProviderError["kind"], message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

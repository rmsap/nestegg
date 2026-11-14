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
  transactions: ProviderTransaction[];
};

export interface TransactionProvider {
  // Stable namespace, including environment when provider IDs can overlap.
  readonly id: string;
  fetchAccounts(): Promise<ProviderAccount[]>;
}

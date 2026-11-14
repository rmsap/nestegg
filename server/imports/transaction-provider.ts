export type ProviderTransaction = {
  externalId: string;
  date: string;
  description: string;
  // Negative is money out. Positive is money in, including refunds.
  amountCents: number;
  kind: "expense" | "income" | "transfer";
  pending: boolean;
  // The provider's own merchant name and category guess, stored verbatim.
  counterparty?: string;
  category?: string;
  // The external id of an earlier pending row of the same account that this row supersedes.
  replaces?: string;
};

export type ProviderAccount = {
  externalId: string;
  name: string;
  kind: "bank" | "credit_card" | "investment" | "loan" | "other";
  currency: string;
  // Credit card balances are positive when money is owed.
  balanceCents: number | null;
  institution?: string;
  lastFour?: string;
  transactions: ProviderTransaction[];
};

export type ProviderContext = {
  // This provider's decrypted settings.
  settings: Record<string, string>;
  request: typeof fetch;
  now: Date;
  // Set by the engine during beginConnect and completeConnect.
  nonce?: string;
};

export type SettingField = {
  name: string;
  label: string;
  kind: "text" | "secret" | "file" | "choice";
  choices?: { value: string; label: string }[];
  required: boolean;
};

export type ConnectStart =
  | { kind: "form"; fields: SettingField[] }
  | { kind: "widget"; widget: string; params: Record<string, string> }
  | { kind: "redirect"; url: string };

export type ProviderAdapter = {
  // Equals providers.key.
  key: string;
  settings: SettingField[];
  transport?(settings: Record<string, string>): typeof fetch;
  beginConnect(ctx: ProviderContext, existingCredential?: string): Promise<ConnectStart>;
  completeConnect(ctx: ProviderContext, payload: unknown, existingCredential?: string): Promise<{ credential: string; label: string }>;
  // The window is inclusive YYYY-MM-DD dates.
  fetchAccounts(ctx: ProviderContext, credential: string, window: { start: string; end: string }): Promise<ProviderAccount[]>;
  disconnect?(ctx: ProviderContext, credential: string): Promise<void>;
};

export class ProviderError extends Error {
  kind: "auth" | "rate_limit" | "unavailable" | "invalid";
  constructor(kind: ProviderError["kind"], message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}

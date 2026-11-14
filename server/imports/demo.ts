import { createHash } from "node:crypto";
import { ProviderError } from "./transaction-provider.ts";
import type { ConnectStart, ProviderAccount, ProviderAdapter, ProviderTransaction } from "./transaction-provider.ts";

const SCENARIOS = ["healthy", "reauth", "outage"];
const DAY = 86_400_000;

const MERCHANTS: [string, string][] = [
  ["Greenleaf Market", "groceries"], ["Corner Pantry", "groceries"], ["Harvest Basket", "groceries"], ["Fresh Fork Grocers", "groceries"],
  ["Copper Kettle Cafe", "dining"], ["Basil & Brine", "dining"], ["Noodle Lantern", "dining"], ["Union Street Pizza", "dining"],
  ["Ridgeline Fuel", "fuel"], ["Pumpkin Road Gas", "fuel"], ["Northstar Petrol", "fuel"],
  ["Birchwood Goods", "shopping"], ["Lumen Home Supply", "shopping"], ["Paperkite Books", "shopping"], ["Tandem Outfitters", "shopping"],
  ["Metro Transit Pass", "transport"], ["Swift Cab", "transport"], ["Parkwell Garage", "transport"],
  ["Brightwater Utilities", "utilities"], ["Skyline Internet", "utilities"], ["Evergreen Power", "utilities"],
  ["Starlight Cinema", "entertainment"], ["Playbox Streaming", "entertainment"], ["Quarry Climbing Gym", "entertainment"], ["Velvet Vinyl Records", "entertainment"],
];

function hash(...parts: (string | number)[]) {
  let h = 2166136261;
  for (const char of parts.join("|")) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  return h >>> 0;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

function credentialOf(text: string) {
  try {
    const value = JSON.parse(text);
    if (typeof value.name === "string" && typeof value.seed === "string" && SCENARIOS.includes(value.scenario)) return value;
  } catch {}
  throw new ProviderError("invalid", "The demo credential is not valid");
}

function form(): ConnectStart {
  return {
    kind: "form",
    fields: [
      { name: "name", label: "Bank name", kind: "text", required: true },
      {
        name: "scenario", label: "Scenario", kind: "choice", required: true,
        choices: [
          { value: "healthy", label: "Healthy" }, { value: "reauth", label: "Needs re-authorization" }, { value: "outage", label: "Provider outage" },
        ],
      },
    ],
  };
}

function transactions(seed: string, start: string, end: string, now: Date) {
  const out = { checking: [] as ProviderTransaction[], card: [] as ProviderTransaction[], loan: [] as ProviderTransaction[] };
  const today = day(now);
  const prefix = seed.slice(0, 12) + ":";
  const todayMs = Date.parse(today + "T00:00:00Z");
  const first = Date.parse(start + "T00:00:00Z"), last = Math.min(Date.parse(end + "T00:00:00Z"), todayMs);
  for (let ms = first; ms <= last; ms += DAY) {
    const date = day(new Date(ms));
    const dom = Number(date.slice(8));
    const pending = (todayMs - ms) / DAY < 2;
    const add = (to: ProviderTransaction[], id: string, description: string, amountCents: number, kind: ProviderTransaction["kind"], extra: Partial<ProviderTransaction> = {}) =>
      to.push({ externalId: `${prefix}${id}:${date}`, date, description, amountCents, kind, pending, ...extra });
    if (dom === 15 || dom === 28) add(out.checking, "pay" + dom, "Acme Corp Payroll", 245000 + (hash(seed, "pay") % 50) * 100, "income");
    if (dom === 1) add(out.checking, "rent", "Maple Court Rent", -(150000 + (hash(seed, "rent") % 10) * 5000), "expense");
    if (dom === 10) {
      const amount = 40000 + (hash(seed, date, "card") % 30) * 1000;
      add(out.checking, "cardpay-out", "Card payment", -amount, "transfer");
      add(out.card, "cardpay-in", "Payment received", amount, "transfer");
    }
    if (dom === 5) {
      add(out.checking, "loanpay-out", "Auto loan payment", -32000, "transfer");
      add(out.loan, "loanpay-in", "Payment received", 32000, "transfer");
    }
    const count = hash(seed, date, "count") % 5;
    for (let i = 0; i < count; i++) {
      const [name, category] = MERCHANTS[hash(seed, date, i, "merchant") % MERCHANTS.length];
      add(out.card, "buy" + i, name, -(500 + hash(seed, date, i, "amount") % 9500), "expense", { counterparty: name, category });
    }
    if (hash(seed, date, "refund") % 40 === 0) {
      const [name, category] = MERCHANTS[hash(seed, date, "refund-merchant") % MERCHANTS.length];
      add(out.card, "refund", name + " refund", 500 + hash(seed, date, "refund-amount") % 4000, "expense", { counterparty: name, category });
    }
  }
  if (start <= today && today <= end) {
    out.card.push({ externalId: `${prefix}hold:${today}`, date: today, description: "Pending hold", amountCents: -5000, kind: "expense", pending: true });
  }
  return out;
}

export const demo: ProviderAdapter = {
  key: "demo",
  settings: [],
  async beginConnect() {
    return form();
  },
  async completeConnect(_ctx, payload, existingCredential) {
    const input = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (name.length < 1 || name.length > 60) throw new ProviderError("invalid", "Bank name must be 1 to 60 characters");
    if (typeof input.scenario !== "string" || !SCENARIOS.includes(input.scenario)) throw new ProviderError("invalid", "Choose a scenario");
    const seed = existingCredential ? credentialOf(existingCredential).seed : createHash("sha256").update(name).digest("hex");
    return { credential: JSON.stringify({ name, scenario: input.scenario, seed }), label: name };
  },
  async fetchAccounts(ctx, credential, window): Promise<ProviderAccount[]> {
    const { name, scenario, seed } = credentialOf(credential);
    if (scenario === "reauth") throw new ProviderError("auth", "The demo bank needs to be re-authorized");
    if (scenario === "outage") throw new ProviderError("unavailable", "The demo bank is unavailable");
    const id = (kind: string) => `${seed.slice(0, 12)}-${kind}`;
    const rows = transactions(seed, window.start, window.end, ctx.now);
    const four = (kind: string) => String(hash(seed, kind, "four") % 10000).padStart(4, "0");
    const base = (kind: string, floor: number, span: number) => floor + (hash(seed, kind, "balance") % span) * 100;
    const account = (externalId: string, label: string, kind: ProviderAccount["kind"], balanceCents: number, list: ProviderTransaction[]): ProviderAccount =>
      ({ externalId, name: label, kind, currency: "USD", balanceCents, institution: name, lastFour: four(externalId), transactions: list });
    return [
      account(id("checking"), "Everyday Checking", "bank", base("checking", 300000, 2000), rows.checking),
      account(id("savings"), "Rainy Day Savings", "bank", base("savings", 1200000, 5000), []),
      account(id("card"), "Rewards Card", "credit_card", base("card", 40000, 1500), rows.card),
      account(id("loan"), "Auto Loan", "loan", base("loan", 1500000, 3000), rows.loan),
    ];
  },
};

export const transfer = "Transfer";
export const uncategorized = "Uncategorized";
export const income = "Income";

const formatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function money(cents: number) {
  return formatter.format(cents / 100);
}

export function parseLimit(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !/^\d{1,7}(\.\d{1,2})?$/.test(value)) {
    return null;
  }
  const [whole, decimal = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return cents <= 100_000_000 ? cents : null;
}

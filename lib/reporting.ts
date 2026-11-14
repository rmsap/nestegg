export const demoMonth = "2026-11";

export function parseMonth(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
}

export function reportingMonth(value: unknown) {
  const now = new Date();
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return parseMonth(value) ?? (process.env.NESTEGG_DEMO === "1" ? demoMonth : current);
}

export function monthLabel(month: string) {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(month + "-01T00:00:00Z"));
}

import { money } from "../lib/finance";

export function Metric({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  return <div className={primary ? "metric primary-metric" : "metric"}>
    <span>{label}</span><strong>{money(value)}</strong>
  </div>;
}

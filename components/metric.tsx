import { money } from "../lib/finance";
import { panelSurface } from "./ui/panel";

export function MetricGrid({ children }: { children: React.ReactNode }) {
  return <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,195px),1fr))] gap-3.5">
    {children}
  </div>;
}

export function Metric({ label, value, primary }: { label: string; value: number; primary?: boolean }) {
  return <div className={`${panelSurface} ${primary ? "bg-green text-white" : "bg-surface"}`}>
    <span className="text-[.9rem]">{label}</span>
    <strong className="mt-1.5 block text-[1.65rem]">{money(value)}</strong>
  </div>;
}

import { monthLabel } from "../lib/reporting";
import { Button } from "./ui/button";
import { Field } from "./ui/field";

export function PageHeading({ title, period }: {
  title: string;
  period?: { month: string; path: string; filters?: Record<string, string> };
}) {
  return <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
    <div>{period && <p className="text-sm text-muted">{monthLabel(period.month)}</p>}<h1>{title}</h1></div>
    {period && <form className="flex flex-wrap items-end gap-2.5" action={period.path} key={period.month}>
      {Object.entries(period.filters ?? {}).map(([name, value]) =>
        <input key={name} type="hidden" name={name} value={value} />)}
      <Field label="Reporting month">
        <input name="month" type="month" defaultValue={period.month} min="1000-01" max="9999-12" required />
      </Field>
      <Button type="submit">Go</Button>
    </form>}
  </header>;
}

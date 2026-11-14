"use client";

import { type CSSProperties, useActionState, useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { defaultPrimaryColor, themeVariables } from "../../lib/theme";
import { saveAppearance } from "./actions";

const swatches = [
  { label: "Primary", classes: "border-primary-border bg-primary text-on-primary" },
  { label: "Strong accent", classes: "border-accent-strong bg-accent-strong text-surface" },
  { label: "Soft accent", classes: "border-line bg-accent text-primary-text" },
  { label: "Sidebar", classes: "border-line bg-sidebar text-ink" },
  { label: "Background", classes: "border-line bg-canvas text-ink" },
];

export function ThemePicker({ initialColor }: { initialColor: string }) {
  const [color, setColor] = useState(initialColor);
  const [error, submit, pending] = useActionState(saveAppearance, null);

  return <div className="mt-3 grid gap-4">
    <form action={submit} className="flex flex-wrap items-end gap-3">
      <Field label="Primary color">
        <input type="color" name="primaryColor" className="h-11 w-16 cursor-pointer" value={color}
          onChange={(event) => setColor(event.currentTarget.value)} />
      </Field>
      <span className="self-end pb-2 font-mono text-sm text-muted">{color.toUpperCase()}</span>
      <Button type="button" disabled={pending} onClick={() => setColor(defaultPrimaryColor)}>Reset color</Button>
      <Button type="submit" variant="primary" disabled={pending || color === initialColor}>
        {pending ? "Saving…" : "Save color"}
      </Button>
    </form>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <ul aria-label="Theme palette preview" style={themeVariables(color) as CSSProperties}
      className="grid grid-cols-[repeat(auto-fit,minmax(115px,1fr))] gap-2">
      {swatches.map(({ label, classes }) => <li key={label}
        className={`rounded-lg border px-3 py-3 text-sm font-semibold ${classes}`}>
        {label}
      </li>)}
    </ul>
  </div>;
}

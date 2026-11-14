"use client";

import { useActionState, useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { colorModes, parseColorMode, themeVariables, type ColorMode } from "../../lib/theme";
import { saveAppearance } from "./actions";

const swatches = [
  { label: "Primary", classes: "border-primary-border bg-primary text-on-primary" },
  { label: "Strong accent", classes: "border-accent-strong bg-accent-strong text-on-accent" },
  { label: "Soft accent", classes: "border-line bg-accent text-primary-text" },
  { label: "Sidebar", classes: "border-line bg-sidebar text-ink" },
  { label: "Background", classes: "border-line bg-canvas text-ink" },
];

export function ThemePicker({ initialColor, initialMode }: { initialColor: string; initialMode: ColorMode }) {
  const [color, setColor] = useState(initialColor);
  const [mode, setMode] = useState(initialMode);
  const [error, submit, pending] = useActionState(saveAppearance, null);
  const hasChanges = color !== initialColor || mode !== initialMode;
  // Override the saved root palette only while this unsaved preview is mounted.
  const previewStyle = hasChanges
    ? `:root {
        ${Object.entries(themeVariables(color)).map(([name, value]) => `${name}: ${value} !important;`).join("\n")}
        color-scheme: ${mode === "system" ? "light dark" : mode};
      }`
    : null;

  return <div className="mt-3 grid gap-4">
    {previewStyle && <style>{previewStyle}</style>}
    <form action={submit} className="flex flex-wrap items-end gap-3">
      <Field label="Color mode">
        <select name="colorMode" value={mode} disabled={pending}
          onChange={(event) => setMode(parseColorMode(event.currentTarget.value) ?? "system")}>
          {colorModes.map((option) => <option key={option} value={option}>
            {option === "system" ? "System (device default)" : option === "light" ? "Light" : "Dark"}
          </option>)}
        </select>
      </Field>
      <Field label="Primary color">
        <input type="color" name="primaryColor" className="h-11 w-16 cursor-pointer" value={color} disabled={pending}
          onChange={(event) => setColor(event.currentTarget.value)} />
      </Field>
      <span className="self-end pb-2 font-mono text-sm text-muted">{color.toUpperCase()}</span>
      <Button type="button" disabled={pending || !hasChanges} onClick={() => {
        setColor(initialColor);
        setMode(initialMode);
      }}>Reset</Button>
      <Button type="submit" variant="primary" disabled={pending || !hasChanges}>
        {pending ? "Saving…" : "Save appearance"}
      </Button>
    </form>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <ul aria-label="Theme palette preview"
      className="grid grid-cols-[repeat(auto-fit,minmax(115px,1fr))] gap-2">
      {swatches.map(({ label, classes }) => <li key={label}
        className={`rounded-lg border px-3 py-3 text-sm font-semibold ${classes}`}>
        {label}
      </li>)}
    </ul>
  </div>;
}

"use client";

import { useActionState, useState } from "react";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { Select } from "../../components/ui/select";
import { colorModes, parseColorMode, parsePrimaryColor, themeVariables, type ColorMode } from "../../lib/theme";
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
  const [hex, setHex] = useState(initialColor.toUpperCase());
  const [mode, setMode] = useState(initialMode);
  const [resets, setResets] = useState(0);
  const [error, submit, pending] = useActionState(saveAppearance, null);
  const hasChanges = color !== initialColor || mode !== initialMode;
  // Override the saved root palette only while this unsaved preview is mounted.
  const previewStyle = hasChanges
    ? `:root {
        ${Object.entries(themeVariables(color)).map(([name, value]) => `${name}: ${value} !important;`).join("\n")}
        color-scheme: ${mode === "system" ? "light dark" : mode};
      }`
    : null;

  return <form action={submit} className="grid gap-5">
    {previewStyle && <style>{previewStyle}</style>}
    <div className="grid max-w-[560px] grid-cols-[repeat(auto-fit,minmax(min(100%,220px),1fr))] gap-4">
      <Field label="Color mode">
        <Select key={resets} name="colorMode" defaultValue={mode} disabled={pending}
          onValueChange={(value) => setMode(parseColorMode(value) ?? "system")}
          options={colorModes.map((option) => ({
            value: option, label: option === "system" ? "System (device default)" : option === "light" ? "Light" : "Dark",
          }))} />
      </Field>
      <Field label="Primary color">
        <span className="flex items-center gap-3">
          <input type="color" name="primaryColor" className="h-[38px] w-14 cursor-pointer p-1 pointer-coarse:h-11" value={color}
            disabled={pending} onChange={(event) => {
              setColor(event.currentTarget.value);
              setHex(event.currentTarget.value.toUpperCase());
            }} />
          <input type="text" aria-label="Primary color hex code" className="w-28 font-mono text-sm tabular-nums uppercase"
            value={hex} maxLength={7} spellCheck={false} autoComplete="off" disabled={pending}
            aria-invalid={parsePrimaryColor(hex.startsWith("#") ? hex : "#" + hex) === null}
            onChange={(event) => {
              const text = event.currentTarget.value.trim();
              setHex(text);
              const parsed = parsePrimaryColor(text.startsWith("#") ? text : "#" + text);
              if (parsed) setColor(parsed);
            }}
            onBlur={() => setHex(color.toUpperCase())} />
        </span>
      </Field>
    </div>
    <div>
      <p className="mb-2 text-sm text-muted">Preview</p>
      <ul aria-label="Theme palette preview"
        className="grid grid-cols-[repeat(auto-fit,minmax(115px,1fr))] gap-2">
        {swatches.map(({ label, classes }) => <li key={label}
          className={`rounded-lg border px-3 py-2 text-sm font-semibold ${classes}`}>
          {label}
        </li>)}
      </ul>
    </div>
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2 border-t border-line pt-4">
      <Button type="submit" variant="primary" disabled={pending || !hasChanges}>
        {pending ? "Saving…" : "Save appearance"}
      </Button>
      <Button type="button" disabled={pending || !hasChanges} onClick={() => {
        setColor(initialColor);
        setHex(initialColor.toUpperCase());
        setMode(initialMode);
        setResets(resets + 1);
      }}>Reset</Button>
    </div>
  </form>;
}

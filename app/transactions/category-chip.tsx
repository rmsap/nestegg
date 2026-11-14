"use client";

import { useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { uncategorized } from "../../lib/finance";
import { changeCategory } from "./actions";

export function CategoryChip({ transactionId, merchant, category, categoryId, choices }: {
  transactionId: number;
  merchant: string;
  category: string;
  categoryId: number | null;
  choices: { id: number; name: string }[];
}) {
  const chip = useRef<HTMLButtonElement>(null);
  const picker = useRef<HTMLSelectElement>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const currentValue = String(categoryId ?? "");

  function open() {
    // Mount the select during the input event so showPicker has user activation.
    flushSync(() => {
      setError(null);
      setEditing(true);
    });
    const select = picker.current;
    select?.focus();
    try {
      select?.showPicker?.();
    } catch {
      // Browsers can still open the focused select with a click or keyboard.
    }
  }

  function close(restoreFocus: boolean) {
    setEditing(false);
    setError(null);
    if (restoreFocus) requestAnimationFrame(() => chip.current?.focus());
  }

  function save(value: string) {
    const data = new FormData();
    data.set("transaction", String(transactionId));
    data.set("category", value);
    startTransition(async () => {
      setError(null);
      try {
        const message = await changeCategory(data);
        if (!message) {
          close(true);
          return;
        }
        setError(message);
      } catch {
        setError("Could not save the category. Try again.");
      }
      if (picker.current) picker.current.value = currentValue;
    });
  }

  if (editing) return <div className="category-editor">
    <select ref={picker} aria-label={`Change category for ${merchant}`}
      defaultValue={currentValue} disabled={pending}
      onChange={(event) => save(event.currentTarget.value)}
      onBlur={(event) => {
        if (!pending && !error && event.currentTarget.value === currentValue) close(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !pending) close(true);
      }}>
      <option value="">{uncategorized}</option>
      {choices.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
    </select>
    {pending && <small role="status">Saving…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;

  return <button ref={chip} type="button" className="category-chip category-chip-editable"
      aria-label={`Change category for ${merchant}, currently ${category}`}
      title="Double-click to change category"
      onDoubleClick={open}
      onClick={(event) => { if (event.detail === 0) open(); }}
      onPointerUp={(event) => { if (event.pointerType !== "mouse") open(); }}>
      {category}
    </button>;
}

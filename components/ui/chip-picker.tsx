"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Chip } from "./chip";

export function ChipPicker({ label, accessibleLabel, optionsLabel, value, options, disabled, onSelect }: {
  label: string;
  accessibleLabel: string;
  optionsLabel: string;
  value: string;
  options: { value: string; name: string }[];
  disabled?: boolean;
  onSelect: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const optionsId = useId();

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !editor.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  return <div className="chip-picker" ref={editor}
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }}>
    <Chip as="button" ref={trigger} aria-label={accessibleLabel}
      aria-expanded={open} aria-controls={open ? optionsId : undefined}
      aria-disabled={disabled} onClick={() => { if (!disabled) setOpen(!open); }}>
      {label}
    </Chip>
    {open && <ul id={optionsId} className="chip-options" aria-label={optionsLabel}>
      {options.map((option) => <li key={option.value}>
        <button type="button" aria-current={option.value === value ? "true" : undefined}
          onClick={() => {
            close();
            if (!disabled && option.value !== value) onSelect(option.value);
          }}>
          {option.name}
        </button>
      </li>)}
    </ul>}
  </div>;
}

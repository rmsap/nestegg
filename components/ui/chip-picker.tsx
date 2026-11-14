"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Chip } from "./chip";

export function ChipPicker({ label, color, accessibleLabel, optionsLabel, value, options, disabled, onSelect }: {
  label: string;
  color?: string;
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

  return <div className="relative w-fit max-w-full" ref={editor}
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }}>
    <Chip as="button" color={color} ref={trigger} aria-label={accessibleLabel}
      aria-expanded={open} aria-controls={open ? optionsId : undefined}
      aria-disabled={disabled} onClick={() => { if (!disabled) setOpen(!open); }}>
      {label}
    </Chip>
    {open && <ul id={optionsId}
      className="absolute start-0 top-[calc(100%+4px)] z-2 max-h-60 w-max min-w-full max-w-[min(220px,calc(100vw-68px))] list-none overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-popover"
      aria-label={optionsLabel}>
      {options.map((option) => <li key={option.value}>
        <button type="button"
          className="block w-full cursor-pointer rounded-[5px] px-2.5 py-1.5 text-left wrap-anywhere hover:bg-accent aria-[current=true]:bg-accent pointer-coarse:min-h-11"
          aria-current={option.value === value ? "true" : undefined}
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

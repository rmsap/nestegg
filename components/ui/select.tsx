"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export function Select({ name, options, defaultValue, placeholder = "Choose an option", required, disabled, onValueChange, "aria-label": ariaLabel }: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
  "aria-label"?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? "");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const entry = useRef(-1);
  const optionsId = useId();
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = options[selectedIndex];
  const empty = !selected || value === "";

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      const scope = root.current?.closest("label") ?? root.current;
      if (event.target instanceof Node && !scope?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  useEffect(() => {
    if (open && entry.current >= 0) items.current[entry.current]?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function show() {
    entry.current = selectedIndex >= 0 ? selectedIndex : 0;
    if (open) items.current[entry.current]?.focus();
    else setOpen(true);
  }

  function choose(next: string) {
    setValue(next);
    if (next !== value) onValueChange?.(next);
    close();
  }

  function navigate(event: KeyboardEvent) {
    const last = options.length - 1;
    const index = items.current.findIndex((item) => item === document.activeElement);
    let target: number | undefined;
    if (event.key === "ArrowDown") target = Math.min(index + 1, last);
    else if (event.key === "ArrowUp") target = Math.max(index - 1, 0);
    else if (event.key === "Home") target = 0;
    else if (event.key === "End") target = last;
    else if (event.key === "Tab") {
      trigger.current?.focus();
      setOpen(false);
      return;
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const key = event.key.toLowerCase();
      target = options.map((_, offset) => (index + 1 + offset) % options.length)
        .find((candidate) => options[candidate]?.label.toLowerCase().startsWith(key));
    }
    if (target === undefined) return;
    event.preventDefault();
    items.current[target]?.focus();
  }

  return <div className="relative" ref={root}
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }}>
    <button type="button" ref={trigger} role="combobox" aria-label={ariaLabel}
      className="flex w-full min-w-0 max-w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-control bg-surface p-2 text-left text-ink aria-disabled:cursor-not-allowed aria-disabled:opacity-60 pointer-coarse:min-h-11"
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? optionsId : undefined}
      aria-disabled={disabled}
      onClick={() => {
        if (disabled) return;
        entry.current = -1;
        setOpen(!open);
      }}
      onKeyDown={(event) => {
        if (disabled || !["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) return;
        event.preventDefault();
        show();
      }}
      onKeyUp={(event) => { if (event.key === " ") event.preventDefault(); }}>
      <span className={`min-w-0 wrap-anywhere ${empty ? "text-muted" : ""}`}>{empty ? placeholder : selected.label}</span>
      <ChevronDown size={16} aria-hidden="true"
        className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
    </button>
    {/* A real input, not type="hidden", so native required validation anchors to the trigger. */}
    <input className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full border-0 p-0 opacity-0"
      tabIndex={-1} aria-hidden="true" autoComplete="off" name={name}
      value={value} required={required} disabled={disabled}
      onChange={() => {}} onFocus={() => trigger.current?.focus()} />
    {open && <ul id={optionsId} role="listbox" aria-label={ariaLabel}
      className="absolute start-0 top-[calc(100%+4px)] z-2 max-h-60 w-max min-w-full max-w-[min(220px,calc(100vw-68px))] list-none overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-popover"
      onClick={(event) => event.preventDefault()} onKeyDown={navigate}>
      {options.map((option, index) => <li key={option.value} role="option" aria-selected={option.value === value}>
        <button type="button" ref={(node) => { items.current[index] = node; }}
          className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[5px] px-2.5 py-1.5 text-left wrap-anywhere hover:bg-accent focus-visible:bg-accent data-[selected=true]:bg-accent pointer-coarse:min-h-11"
          data-selected={option.value === value}
          onClick={() => choose(option.value)}>
          {option.label}
          {option.value === value && <Check size={15} aria-hidden="true" className="shrink-0" />}
        </button>
      </li>)}
    </ul>}
  </div>;
}

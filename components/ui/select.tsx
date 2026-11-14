"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export function Select({ name, options, defaultValue, placeholder = "Choose an option", required, disabled, "aria-label": ariaLabel }: {
  name: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
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

  return <div className="select" ref={root}
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
      }
    }}>
    <button type="button" ref={trigger} className="select-trigger" role="combobox" aria-label={ariaLabel}
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
      <span className={empty ? "select-placeholder" : undefined}>{empty ? placeholder : selected.label}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </button>
    {/* A real input, not type="hidden", so native required validation anchors to the trigger. */}
    <input className="select-proxy" tabIndex={-1} aria-hidden="true" autoComplete="off" name={name}
      value={value} required={required} disabled={disabled}
      onChange={() => {}} onFocus={() => trigger.current?.focus()} />
    {open && <ul id={optionsId} className="select-options" role="listbox" aria-label={ariaLabel}
      onClick={(event) => event.preventDefault()} onKeyDown={navigate}>
      {options.map((option, index) => <li key={option.value} role="option" aria-selected={option.value === value}>
        <button type="button" ref={(node) => { items.current[index] = node; }}
          onClick={() => choose(option.value)}>
          {option.label}
          {option.value === value && <Check size={15} aria-hidden="true" />}
        </button>
      </li>)}
    </ul>}
  </div>;
}

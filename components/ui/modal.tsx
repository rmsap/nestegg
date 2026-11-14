"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

const focusable = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

export function Modal({ title, closeHref, step, children }: {
  title: string;
  closeHref: string;
  step?: { current: number; total: number };
  children: ReactNode;
}) {
  const router = useRouter();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const leave = () => router.push(closeHref, { scroll: false });
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  const items = () => [...panel.current?.querySelectorAll<HTMLElement>(focusable) ?? []].filter((element) => element.offsetParent !== null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) leaveRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const target = items().find((element) => element !== close.current) ?? close.current ?? panel.current;
    target?.focus();
  }, [title]);

  function trap(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Tab") return;
    const list = items();
    if (list.length === 0) {
      event.preventDefault();
      panel.current?.focus();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panel.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !list.includes(active as HTMLElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  return <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4 transition-opacity duration-150 starting:opacity-0 motion-reduce:transition-none compact:items-end compact:p-0"
    onPointerDown={(event) => { if (event.target === event.currentTarget) leave(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={trap}
      className="max-h-[calc(100dvh-32px)] w-full max-w-[480px] overflow-y-auto rounded-[14px] border border-line bg-surface p-5 shadow-popover outline-none compact:max-w-none compact:rounded-b-none compact:p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0 wrap-anywhere">
          {step && <p className="text-sm text-muted">Step {step.current} of {step.total}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button ref={close} type="button" aria-label="Close" onClick={leave}
          className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent p-2 text-muted hover:bg-accent pointer-coarse:min-h-11 pointer-coarse:min-w-11">
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      {children}
    </div>
  </div>;
}

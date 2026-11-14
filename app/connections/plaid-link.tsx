"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "../../components/ui/button";
import { finishWidget } from "./actions";

type Item = { providerKey: string; linkToken: string; state: string; mode: "create" | "update" };
type Handler = { open(): void; exit(options?: { force?: boolean }): void; destroy(): void };
type Options = {
  token: string;
  receivedRedirectUri?: string;
  onSuccess(publicToken: string, metadata: { institution?: { name?: string } | null }): void;
  onExit(error: unknown, metadata: unknown): void;
};

declare global {
  interface Window { Plaid?: { create(options: Options): Handler } }
}

const script = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
const storageKey = "nestegg.plaid-link";
let loading: Promise<void> | undefined;

function loadLink() {
  if (window.Plaid) return Promise.resolve();
  return loading ??= new Promise<void>((resolve, reject) => {
    const element = document.createElement("script");
    element.src = script;
    element.async = true;
    element.onload = () => resolve();
    element.onerror = () => {
      loading = undefined;
      element.remove();
      reject(new Error("Link failed to load"));
    };
    document.head.append(element);
  });
}

function useLink(item: Item, resuming: boolean) {
  const router = useRouter();
  const handler = useRef<Handler | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let current = true;
    loadLink().then(() => current && setStatus("ready"), () => current && setStatus("failed"));
    return () => {
      current = false;
      handler.current?.destroy();
    };
  }, []);

  function open() {
    if (!window.Plaid) return;
    setError(null);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(item));
    } catch {}
    handler.current?.destroy();
    handler.current = window.Plaid.create({
      token: item.linkToken,
      ...(resuming ? { receivedRedirectUri: window.location.href } : {}),
      onSuccess(publicToken, metadata) {
        startTransition(async () => {
          try {
            const result = await finishWidget(item.providerKey, item.state,
              { publicToken, institutionName: metadata.institution?.name });
            if (!result.ok) return setError(result.message);
            try {
              sessionStorage.removeItem(storageKey);
            } catch {}
            router.replace(result.href);
          } catch {
            setError("Could not finish the connection. Try again.");
          }
        });
      },
      onExit(exitError) {
        if (exitError) setError("Sign-in was not completed.");
      },
    });
    handler.current.open();
  }

  return { status, error, pending, open };
}

function LinkButton({ status, error, pending, open }: ReturnType<typeof useLink>) {
  return <>
    <Button type="button" variant="primary" size="sm" disabled={status !== "ready" || pending} onClick={open}>
      {status === "loading" ? "Loading…" : "Continue to your bank"}
    </Button>
    {pending && <p className="text-sm text-muted" role="status">Saving…</p>}
    {status === "failed" && <p className="w-full text-sm text-danger" role="alert">Could not load the sign-in. Check your connection and reload.</p>}
    {error && <p className="w-full text-sm text-danger" role="alert">{error}</p>}
  </>;
}

export function PlaidLink(item: Item) {
  return <LinkButton {...useLink(item, false)} />;
}

function Resume({ item }: { item: Item }) {
  const link = useLink(item, true);
  const started = useRef(false);
  useEffect(() => {
    if (link.status !== "ready" || started.current) return;
    started.current = true;
    link.open();
  });
  return <div className="flex flex-wrap items-center gap-2"><LinkButton {...link} /></div>;
}

export function PlaidResume() {
  const [item, setItem] = useState<Item | null | undefined>(undefined);
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(storageKey);
      setItem(stored ? JSON.parse(stored) as Item : null);
    } catch {
      setItem(null);
    }
  }, []);
  if (item === undefined) return <p className="text-sm text-muted">Loading…</p>;
  if (item === null) return <p>This sign-in could not be resumed. <Link href="/connections">Start again.</Link></p>;
  return <Resume item={item} />;
}

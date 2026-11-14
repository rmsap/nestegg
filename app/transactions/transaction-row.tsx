"use client";

import { ChevronRight, TriangleExclamationPoint } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { Chip } from "../../components/ui/chip";
import { Button } from "../../components/ui/button";
import { money, uncategorized } from "../../lib/finance";
import type { Transaction } from "../../server/transactions/queries";
import { saveTransactionReview } from "./actions";
import { CategoryChip } from "./category-chip";

export type CategoryChoice = { id: number; name: string };

const expansionCard = "col-start-2 col-end-[-1] mt-1 rounded-lg border border-line bg-inset p-2.5 compact:row-start-3";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
});

export function TransactionRow({ transaction, categoryChoices, hasLeadingColumn }: {
  transaction: Transaction;
  categoryChoices?: CategoryChoice[];
  hasLeadingColumn: boolean;
}) {
  const [expansion, setExpansion] = useState<"memo" | "review" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { id, merchant, account, date, category, category_id, kind, pending, reviewed, memo } = transaction;
  const canEditCategory = categoryChoices !== undefined && kind === "expense";
  const disclosure = memo ? "memo" : categoryChoices && !pending && !reviewed ? "review" : null;
  const open = disclosure !== null && expansion === disclosure;
  const isMemo = disclosure === "memo";
  const merchantColumn = hasLeadingColumn ? "compact:col-start-2" : "compact:col-start-1";
  const amountColumn = hasLeadingColumn ? "compact:col-start-3" : "compact:col-start-2";

  function toggle() {
    if (saving || !disclosure) return;
    setError(null);
    setExpansion(open ? null : disclosure);
  }

  function save(data: FormData) {
    if (saving) return;
    startTransition(async () => {
      setError(null);
      try {
        const message = await saveTransactionReview(data);
        if (message) setError(message);
        else setExpansion(null);
      } catch {
        setError("Could not save the review. Try again.");
      }
    });
  }

  return <div className={`col-span-full grid grid-cols-subgrid items-center gap-y-1 border-t border-line py-1.5 wrap-anywhere ${isMemo ? "cursor-pointer" : ""}`}
    onClick={isMemo ? (event) => {
      if (event.target instanceof Element &&
        !event.target.closest("button, a, input, select, [data-memo-panel]") &&
        !window.getSelection()?.toString()) toggle();
    } : undefined}
    onKeyDown={(event) => {
      if (event.defaultPrevented || event.key !== "Escape" || saving || !open) return;
      event.preventDefault();
      setExpansion(null);
      trigger.current?.focus();
    }}>
    {disclosure ? <button type="button" ref={trigger}
      className={`grid w-(--review-width) min-h-(--review-width) cursor-pointer place-items-center compact:col-start-1 compact:row-start-1 compact:row-span-2 ${isMemo ? "text-green aria-expanded:[&>svg]:rotate-90" : "rounded-full bg-[#ffe49a] text-[#694a00]"}`}
      aria-label={isMemo ? `${open ? "Hide" : "Show"} memo for ${merchant}` : `Review ${merchant}`}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      title={isMemo ? undefined : "Needs review"} aria-disabled={saving}
      onClick={toggle}>
      {isMemo ? <ChevronRight size={17} aria-hidden="true" /> : <TriangleExclamationPoint size={17} aria-hidden="true" />}
    </button> : hasLeadingColumn && <div className="compact:col-start-1 compact:row-start-1 compact:row-span-2" />}
    <div className={`compact:row-start-1 ${merchantColumn}`}><strong>{merchant}</strong></div>
    <span className={`text-sm text-muted compact:row-start-2 ${merchantColumn}`}>
      {dateFormat.format(new Date(date))} · {account}{pending ? " · Pending" : ""}
    </span>
    <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 compact:row-start-2 ${amountColumn}`}>
      {canEditCategory
        ? <CategoryChip transactionId={id} merchant={merchant} categoryId={category_id} choices={categoryChoices} />
        : categoryChoices ? <Chip>{category}</Chip> : <span>{category}</span>}
    </div>
    <strong className={`text-right whitespace-nowrap tabular-nums compact:row-start-1 ${amountColumn}`}>{money(transaction.amount_cents)}</strong>
    {open && isMemo && <div id={panelId} data-memo-panel className={`${expansionCard} cursor-text`}>
      <strong>Memo</strong>
      <p className="mt-1 whitespace-pre-wrap">{memo}</p>
    </div>}
    {open && disclosure === "review" && <form id={panelId}
      className={`${expansionCard} me-[calc(var(--review-width)+var(--activity-gap))] flex min-w-0 flex-wrap items-center gap-2`}
      onSubmit={(event) => {
      event.preventDefault();
      save(new FormData(event.currentTarget));
    }}>
      <input type="hidden" name="transaction" value={id} />
      {canEditCategory
        ? <select name="category" aria-label="Category" className="max-w-[min(220px,100%)] flex-[1_1_140px]"
            defaultValue={String(category_id ?? "")} disabled={saving}>
          <option value="">{uncategorized}</option>
          {categoryChoices.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
        : <Chip>{category}</Chip>}
      <input type="text" name="memo" className="flex-[3_1_160px]" aria-label="Memo (optional)" placeholder="Memo (optional)"
        maxLength={500} disabled={saving} />
      <Button type="submit" variant="primary" className="ms-auto" disabled={saving}>
        {saving ? "Saving…" : canEditCategory ? "Categorize" : "Mark reviewed"}
      </Button>
      {error && <small className="basis-full text-danger" role="alert">{error}</small>}
    </form>}
  </div>;
}

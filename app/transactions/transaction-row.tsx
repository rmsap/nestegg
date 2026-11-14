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

  return <div className={isMemo ? "activity-row activity-row-with-memo" : "activity-row"}
    onClick={isMemo ? (event) => {
      if (event.target instanceof Element &&
        !event.target.closest("button, a, input, select, .activity-memo-panel") &&
        !window.getSelection()?.toString()) toggle();
    } : undefined}
    onKeyDown={(event) => {
      if (event.defaultPrevented || event.key !== "Escape" || saving || !open) return;
      event.preventDefault();
      setExpansion(null);
      trigger.current?.focus();
    }}>
    {disclosure ? <button type="button" ref={trigger}
      className={`activity-review ${isMemo ? "memo-toggle" : "review-trigger"}`}
      aria-label={isMemo ? `${open ? "Hide" : "Show"} memo for ${merchant}` : `Review ${merchant}`}
      aria-expanded={open} aria-controls={open ? panelId : undefined}
      title={isMemo ? undefined : "Needs review"} aria-disabled={saving}
      onClick={toggle}>
      {isMemo ? <ChevronRight size={17} aria-hidden="true" /> : <TriangleExclamationPoint size={17} aria-hidden="true" />}
    </button> : hasLeadingColumn && <div className="activity-review" />}
    <div className="activity-merchant"><strong>{merchant}</strong></div>
    <span className="activity-account muted">
      {dateFormat.format(new Date(date))} · {account}{pending ? " · Pending" : ""}
    </span>
    <div className="activity-category">
      {canEditCategory
        ? <CategoryChip transactionId={id} merchant={merchant} categoryId={category_id} choices={categoryChoices} />
        : categoryChoices ? <Chip>{category}</Chip> : <span>{category}</span>}
    </div>
    <strong className="amount">{money(transaction.amount_cents)}</strong>
    {open && isMemo && <div id={panelId} className="activity-memo-panel">
      <strong>Memo</strong>
      <p>{memo}</p>
    </div>}
    {open && disclosure === "review" && <form id={panelId} className="review-options" onSubmit={(event) => {
      event.preventDefault();
      save(new FormData(event.currentTarget));
    }}>
      <input type="hidden" name="transaction" value={id} />
      {canEditCategory
        ? <select name="category" aria-label="Category" defaultValue={String(category_id ?? "")} disabled={saving}>
          <option value="">{uncategorized}</option>
          {categoryChoices.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
        </select>
        : <Chip>{category}</Chip>}
      <input type="text" name="memo" aria-label="Memo (optional)" placeholder="Memo (optional)"
        maxLength={500} disabled={saving} />
      <Button type="submit" variant="primary" disabled={saving}>
        {saving ? "Saving…" : canEditCategory ? "Categorize" : "Mark reviewed"}
      </Button>
      {error && <small role="alert">{error}</small>}
    </form>}
  </div>;
}

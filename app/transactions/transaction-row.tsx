"use client";

import { ChevronRight, Target, TriangleExclamationPoint } from "lucide-react";
import { useId, useRef, useState, useTransition } from "react";
import { Chip } from "../../components/ui/chip";
import { Button } from "../../components/ui/button";
import { money, uncategorized } from "../../lib/finance";
import type { GoalChoice } from "../../server/goals/goals";
import type { Transaction } from "../../server/transactions/queries";
import { saveTransactionReview } from "./actions";
import { CategoryChip } from "./category-chip";
import { GoalSpendPicker } from "./goal-spend-picker";

export type CategoryChoice = { id: number; name: string; color: string };

const expansionCard = "col-start-2 col-end-[-1] mt-1 rounded-lg border border-line bg-inset p-2.5 compact:row-start-3";

const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", timeZone: "UTC",
});

export function TransactionRow({ transaction, categoryChoices, goalChoices, hasLeadingColumn }: {
  transaction: Transaction;
  categoryChoices?: CategoryChoice[];
  goalChoices?: GoalChoice[];
  hasLeadingColumn: boolean;
}) {
  const [expansion, setExpansion] = useState<"memo" | "review" | "goal" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();
  const trigger = useRef<HTMLButtonElement>(null);
  const goalTrigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { id, merchant, account, date, category, category_id, kind, pending, reviewed, memo } = transaction;
  const canEditCategory = categoryChoices !== undefined && kind === "expense";
  const disclosure = memo ? "memo" : categoryChoices && !pending && !reviewed ? "review" : null;
  const open = disclosure !== null && expansion === disclosure;
  const isMemo = disclosure === "memo";
  const goalOpen = expansion === "goal";
  const showGoal = goalChoices && (transaction.goal_name || goalChoices.length > 0);
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
        setError("Could not save the transaction changes. Try again.");
      }
    });
  }

  return <div className={`col-span-full grid grid-cols-subgrid items-center gap-y-1 border-t border-line py-1.5 wrap-anywhere ${isMemo ? "cursor-pointer" : ""}`}
    onClick={isMemo ? (event) => {
      if (event.target instanceof Element &&
        !event.target.closest("button, a, input, select, [data-row-panel]") &&
        !window.getSelection()?.toString()) toggle();
    } : undefined}
    onKeyDown={(event) => {
      if (event.defaultPrevented || event.key !== "Escape" || saving || (!open && !goalOpen)) return;
      event.preventDefault();
      setExpansion(null);
      (goalOpen ? goalTrigger : trigger).current?.focus();
    }}>
    {disclosure ? <button type="button" ref={trigger}
      className={`grid w-(--review-width) min-h-(--review-width) cursor-pointer place-items-center compact:col-start-1 compact:row-start-1 compact:row-span-2 ${isMemo ? "text-primary-text aria-expanded:[&>svg]:rotate-90" : "rounded-full bg-warning text-warning-text"}`}
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
      {showGoal && <button type="button" ref={goalTrigger} aria-expanded={goalOpen}
        aria-controls={goalOpen ? panelId : undefined}
        aria-label={transaction.goal_name ? `Goal funds for ${merchant}` : `Use goal funds for ${merchant}`}
        title={transaction.goal_name ?? "Use goal funds"} disabled={saving}
        className={`grid size-7 cursor-pointer place-items-center rounded-md text-primary-text hover:bg-accent pointer-coarse:size-11 ${transaction.goal_name ? "bg-accent" : ""}`}
        onClick={() => setExpansion(goalOpen ? null : "goal")}>
        <Target size={16} aria-hidden="true" />
      </button>}
    </div>
    <strong className={`text-right whitespace-nowrap tabular-nums compact:row-start-1 ${amountColumn}`}>{money(transaction.amount_cents)}</strong>
    {open && isMemo && <div id={panelId} data-row-panel className={`${expansionCard} cursor-text`}>
      <strong>Memo</strong>
      <p className="mt-1 whitespace-pre-wrap">{memo}</p>
    </div>}
    {open && disclosure === "review" && <form id={panelId} data-row-panel
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
    {goalChoices && showGoal && goalOpen && <div id={panelId} data-row-panel className={expansionCard}>
      <GoalSpendPicker transaction={transaction} choices={goalChoices}
        onSaved={() => setExpansion((current) => current === "goal" ? null : current)} />
    </div>}
  </div>;
}

"use client";

import { useActionState } from "react";
import { Button } from "../../components/ui/button";
import { money } from "../../lib/finance";
import type { GoalChoice } from "../../server/goals/goals";
import type { Transaction } from "../../server/transactions/queries";
import { saveGoalSpending } from "./actions";

export function GoalSpendPicker({ transaction, choices, onSaved }: {
  transaction: Transaction;
  choices: GoalChoice[];
  onSaved: () => void;
}) {
  const [error, submit, saving] = useActionState(async (_previous: string | null, form: FormData) => {
    try {
      const message = await saveGoalSpending(form);
      if (!message) onSaved();
      return message;
    } catch {
      return "Could not save the goal. Try again.";
    }
  }, null);

  if (transaction.goal_name) return <p>Covered by <strong>{transaction.goal_name}</strong></p>;

  return <form className="flex flex-wrap items-center gap-2" action={submit}>
    <input type="hidden" name="transaction" value={transaction.id} />
    <select name="goal" aria-label="Savings goal" defaultValue="" required disabled={saving}>
      <option value="" disabled>Choose a goal</option>
      {choices.map(({ id, name, saved }) => <option key={id} value={id} disabled={saved < -transaction.amount_cents}>
        {name} · {money(saved)} saved
      </option>)}
    </select>
    <Button type="submit" variant="primary" size="sm" disabled={saving}>{saving ? "Saving…" : "Use goal funds"}</Button>
    {error && <small className="basis-full text-danger" role="alert">{error}</small>}
  </form>;
}

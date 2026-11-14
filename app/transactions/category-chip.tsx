"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ChipPicker } from "../../components/ui/chip-picker";
import { uncategorized } from "../../lib/finance";
import { saveTransactionReview } from "./actions";
import type { CategoryChoice } from "./transaction-row";

export function CategoryChip({ transactionId, merchant, categoryId, choices }: {
  transactionId: number;
  merchant: string;
  categoryId: number | null;
  choices: CategoryChoice[];
}) {
  const [value, setOptimisticValue] = useOptimistic(String(categoryId ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = [{ value: "", name: uncategorized },
    ...choices.map(({ id, name }) => ({ value: String(id), name }))];
  const selected = choices.find((choice) => String(choice.id) === value);
  const label = selected?.name ?? uncategorized;

  function save(selection: string) {
    const data = new FormData();
    data.set("transaction", String(transactionId));
    data.set("category", selection);
    startTransition(async () => {
      setError(null);
      setOptimisticValue(selection);
      try {
        setError(await saveTransactionReview(data));
      } catch {
        setError("Could not save the category. Try again.");
      }
    });
  }

  return <div>
    <ChipPicker label={label} color={selected?.color} accessibleLabel={`Category for ${merchant}, currently ${label}`}
      optionsLabel="Categories" value={value} options={options} disabled={pending} onSelect={save} />
    {pending && <small className="block" role="status">Saving…</small>}
    {error && <small className="block text-danger" role="alert">{error}</small>}
  </div>;
}

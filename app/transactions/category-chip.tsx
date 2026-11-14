"use client";

import { useOptimistic, useState, useTransition } from "react";
import { ChipPicker } from "../../components/ui/chip-picker";
import { uncategorized } from "../../lib/finance";
import { saveTransactionReview } from "./actions";

export function CategoryChip({ transactionId, merchant, categoryId, choices }: {
  transactionId: number;
  merchant: string;
  categoryId: number | null;
  choices: { id: number; name: string }[];
}) {
  const [value, setOptimisticValue] = useOptimistic(String(categoryId ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const options = [{ value: "", name: uncategorized },
    ...choices.map(({ id, name }) => ({ value: String(id), name }))];
  const label = options.find((option) => option.value === value)?.name ?? uncategorized;

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

  return <div className="category-editor">
    <ChipPicker label={label} accessibleLabel={`Category for ${merchant}, currently ${label}`}
      optionsLabel="Categories" value={value} options={options} disabled={pending} onSelect={save} />
    {pending && <small role="status">Saving…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}

"use server";

import { revalidatePath } from "next/cache";
import { readId } from "../../lib/forms";
import { updateCategory } from "../../server/transactions/mutations";

export async function changeCategory(form: FormData) {
  const transactionId = readId(form.get("transaction"));
  const selection = form.get("category");
  const categoryId = selection === "" ? null : readId(selection);
  if (!transactionId || categoryId === 0 || !updateCategory(transactionId, categoryId)) {
    return "This transaction or category is no longer available.";
  }
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/");
  return null;
}


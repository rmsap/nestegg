"use server";

import { revalidatePath } from "next/cache";
import { readId } from "../../lib/forms";
import { database } from "../../server/db/connection";
import { currentUser } from "../../server/session";
import { saveReview } from "../../server/transactions/mutations";

export async function saveTransactionReview(form: FormData) {
  const user = await currentUser();
  const transactionId = readId(form.get("transaction"));
  const selection = form.get("category");
  const categoryId = selection === null ? undefined : selection === "" ? null : readId(selection);
  const memo = form.get("memo");
  if (memo !== null && (typeof memo !== "string" || memo.length > 500)) {
    return "Enter a memo of up to 500 characters.";
  }
  const note = memo === null ? undefined : memo.trim() || null;
  if (!transactionId || categoryId === 0 || !saveReview(database(), user.id, transactionId, { memo: note, categoryId })) {
    return "This transaction or category is no longer available.";
  }
  revalidatePath("/transactions");
  revalidatePath("/budget");
  revalidatePath("/");
  return null;
}


"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { parseLimit } from "../../lib/finance";
import { readId } from "../../lib/forms";
import { database } from "../../server/db/connection";
import { changeGoalState, editGoal, GoalFundingError, insertGoal, releaseGoalFunds, setGoalCashBuffer } from "../../server/goals/goals";
import { currentUser } from "../../server/session";

async function saveGoalChange(back: string, work: (db: ReturnType<typeof database>, userId: number) => void) {
  const user = await currentUser();
  try {
    work(database(), user.id);
  } catch (error) {
    if (!(error instanceof GoalFundingError)) throw error;
    redirect(`${back}${back.includes("?") ? "&" : "?"}notice=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/goals");
  revalidatePath("/transactions");
  redirect("/goals");
}

export async function createGoal(form: FormData) {
  const input = form.get("name");
  const name = typeof input === "string" ? input.trim() : "";
  const target = parseLimit(form.get("target"));
  const accountId = readId(form.get("account"));
  const mode = form.get("mode");

  await saveGoalChange("/goals?add=1", (db, userId) => {
    if (!name || name.length > 60 || !target) {
      throw new GoalFundingError("Enter a goal name and a target greater than zero.");
    }
    if (mode !== "one-time" && mode !== "refillable") throw new GoalFundingError("Choose a goal type.");
    insertGoal(db, userId, { name, target_cents: target, account_id: accountId, funding_mode: mode });
  });
}

export async function saveGoalSettings(form: FormData) {
  const id = readId(form.get("goal"));
  const account = form.get("account");
  const accountId = readId(account);
  const mode = form.get("mode");
  await saveGoalChange(`/goals?goal=${id}&edit=settings`, (db, userId) => {
    if (mode !== "one-time" && mode !== "refillable") throw new GoalFundingError("Choose a goal type.");
    if (account && !accountId) throw new GoalFundingError("Choose an open bank account.");
    editGoal(db, userId, id, mode, accountId || undefined);
  });
}

export async function releaseFunds(form: FormData) {
  const id = readId(form.get("goal"));
  const amount = parseLimit(form.get("amount"));
  await saveGoalChange(`/goals?goal=${id}&edit=release`, (db, userId) => {
    if (!amount) throw new GoalFundingError("Enter an amount greater than zero.");
    releaseGoalFunds(db, userId, id, amount);
  });
}

export async function saveCashBuffer(form: FormData) {
  const id = readId(form.get("account"));
  const amount = parseLimit(form.get("amount"));
  await saveGoalChange(`/goals?buffer=${id}`, (db, userId) => {
    if (amount === null) throw new GoalFundingError("Enter a valid cash buffer.");
    setGoalCashBuffer(db, userId, id, amount);
  });
}

export async function updateGoalState(form: FormData) {
  const id = readId(form.get("goal"));
  const state = form.get("state");
  await saveGoalChange("/goals", (db, userId) => {
    if (state !== "spending" && state !== "closed") throw new GoalFundingError("Choose a valid goal status.");
    changeGoalState(db, userId, id, state);
  });
}

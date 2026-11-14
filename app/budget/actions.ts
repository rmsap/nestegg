"use server";

import { redirect } from "next/navigation";
import { readId } from "../../lib/forms";
import { income, parseLimit, transfer, uncategorized } from "../../lib/finance";
import { parseMonth } from "../../lib/reporting";
import { parsePrimaryColor } from "../../lib/theme";
import { insertCategory, removeCategory, updateCategories } from "../../server/budget/mutations";
import { database } from "../../server/db/connection";
import { currentUser } from "../../server/session";
import { revalidatePath } from "next/cache";

function budget(message: string, month: string | null, editing = false): never {
  const params = new URLSearchParams({ notice: message });
  if (month) params.set("month", month);
  if (editing) params.set("edit", "1");
  redirect("/budget?" + params.toString());
}

export async function addCategory(form: FormData) {
  const user = await currentUser();
  const month = parseMonth(form.get("month"));
  if (!month) budget("Choose a valid reporting month.", null);
  const input = form.get("name");
  const name = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  const limit = parseLimit(form.get("limit"));
  const color = parsePrimaryColor(form.get("color"));
  if (!name || name.length > 60 || limit === null) {
    budget("Enter a name of up to 60 characters and a valid monthly limit.", month);
  }
  if (!color) budget("Choose a valid category color.", month);
  if ([income, transfer, uncategorized].some((value) => value.toLowerCase() === name.toLowerCase())) {
    budget("That category name is reserved.", month);
  }
  const added = insertCategory(database(), user.id, name, month, limit, color);
  if (added) revalidatePath("/transactions");
  budget(added ? "Category added." : "A category with that name already exists.", month);
}

export async function saveCategories(form: FormData) {
  const user = await currentUser();
  const month = parseMonth(form.get("month"));
  if (!month) budget("Choose a valid reporting month.", null);
  const updates: { id: number; limit: number; color: string }[] = [];
  for (const [key, value] of form) {
    if (!key.startsWith("limit-")) continue;
    const id = readId(key.slice(6));
    const limit = parseLimit(value);
    if (!id || limit === null) budget("Enter a valid limit for each category.", month, true);
    const color = parsePrimaryColor(form.get(`color-${id}`));
    if (!color) budget("Choose a valid color for each category.", month, true);
    updates.push({ id, limit, color });
  }
  updateCategories(database(), user.id, month, updates);
  revalidatePath("/transactions");
  budget("Categories saved.", month);
}

export async function deleteCategory(form: FormData) {
  const user = await currentUser();
  const month = parseMonth(form.get("month"));
  if (!month) budget("Choose a valid reporting month.", null);
  const result = removeCategory(database(), user.id, readId(form.get("category")), readId(form.get("replacement")));
  const messages = {
    deleted: "Category deleted.",
    missing: "That category no longer exists.",
    "replacement-required": "Choose another category for the existing transactions.",
  };
  budget(messages[result], month, true);
}

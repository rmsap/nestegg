"use server";

import { revalidatePath } from "next/cache";
import { parsePrimaryColor } from "../../lib/theme";
import { setOwnerPrimaryColor } from "../../server/users/appearance";

export async function saveAppearance(_previous: string | null, form: FormData) {
  const color = parsePrimaryColor(form.get("primaryColor"));
  if (!color) return "Choose a valid primary color.";
  setOwnerPrimaryColor(color);
  revalidatePath("/", "layout");
  return null;
}

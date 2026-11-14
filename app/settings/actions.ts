"use server";

import { revalidatePath } from "next/cache";
import { parsePrimaryColor } from "../../lib/theme";
import { database } from "../../server/db/connection";
import { currentUser } from "../../server/session";
import { setUserPrimaryColor } from "../../server/users/users";

export async function saveAppearance(_previous: string | null, form: FormData) {
  const user = await currentUser();
  const color = parsePrimaryColor(form.get("primaryColor"));
  if (!color) return "Choose a valid primary color.";
  setUserPrimaryColor(database(), user.id, color);
  revalidatePath("/", "layout");
  return null;
}

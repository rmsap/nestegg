"use server";

import { revalidatePath } from "next/cache";
import { parseColorMode, parsePrimaryColor } from "../../lib/theme";
import { database } from "../../server/db/connection";
import { currentUser } from "../../server/session";
import { setUserAppearance } from "../../server/users/users";

export async function saveAppearance(_previous: string | null, form: FormData) {
  const user = await currentUser();
  const color = parsePrimaryColor(form.get("primaryColor"));
  if (!color) return "Choose a valid primary color.";
  const mode = parseColorMode(form.get("colorMode"));
  if (!mode) return "Choose a valid color mode.";
  setUserAppearance(database(), user.id, color, mode);
  revalidatePath("/", "layout");
  return null;
}

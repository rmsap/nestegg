"use server";

import { revalidatePath } from "next/cache";
import { parseColorMode, parsePrimaryColor } from "../../lib/theme";
import { setOwnerAppearance } from "../../server/users/appearance";

export async function saveAppearance(_previous: string | null, form: FormData) {
  const color = parsePrimaryColor(form.get("primaryColor"));
  if (!color) return "Choose a valid primary color.";
  const mode = parseColorMode(form.get("colorMode"));
  if (!mode) return "Choose a valid color mode.";
  setOwnerAppearance(color, mode);
  revalidatePath("/", "layout");
  return null;
}

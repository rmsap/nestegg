import { parseColorMode, primaryColor, type ColorMode } from "../../lib/theme";
import { database } from "../db/connection";

// Resolve this from the authenticated session once sign-in is implemented.
const localOwnerId = 1;

export function ownerAppearance() {
  const user = database().prepare("SELECT primary_color, color_mode FROM users WHERE id = ?").get(localOwnerId);
  return {
    color: primaryColor(user?.primary_color),
    mode: parseColorMode(user?.color_mode) ?? "system",
  };
}

export function setOwnerAppearance(color: string, mode: ColorMode) {
  database().prepare("UPDATE users SET primary_color = ?, color_mode = ? WHERE id = ?")
    .run(color, mode, localOwnerId);
}

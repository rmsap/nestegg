import { primaryColor } from "../../lib/theme";
import { database } from "../db/connection";

// Resolve this from the authenticated session once sign-in is implemented.
const localOwnerId = 1;

export function ownerPrimaryColor() {
  const user = database().prepare("SELECT primary_color FROM users WHERE id = ?").get(localOwnerId);
  return primaryColor(user?.primary_color);
}

export function setOwnerPrimaryColor(color: string) {
  database().prepare("UPDATE users SET primary_color = ? WHERE id = ?").run(color, localOwnerId);
}

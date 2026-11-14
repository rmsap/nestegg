import "server-only";
import { database } from "./db/connection";

export async function currentUser() {
  const row = database().prepare("SELECT id, role FROM users ORDER BY id LIMIT 1").get();
  if (!row) throw new Error("No user exists");
  return { id: Number(row.id), role: String(row.role) as "admin" | "member" };
}

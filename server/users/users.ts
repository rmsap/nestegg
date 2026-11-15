import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { parseColorMode, primaryColor, type ColorMode } from "../../lib/theme.ts";
import { recordEvent } from "../events.ts";

const LOG_N = 15, R = 8, P = 1, KEY = 32;
const MAXMEM = 256 * 1024 * 1024;

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY, { N: 2 ** LOG_N, r: R, p: P, maxmem: MAXMEM });
  return ["scrypt", LOG_N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password: string, stored: unknown) {
  try {
    if (typeof stored !== "string" || typeof password !== "string") return false;
    const [scheme, log, r, p, salt, hash, ...extra] = stored.split("$");
    const [logN, rounds, lanes] = [log, r, p].map(Number);
    if (scheme !== "scrypt" || extra.length || hash === undefined || ![logN, rounds, lanes].every(Number.isInteger) ||
      logN < 10 || logN > 20 || rounds < 1 || rounds > 32 || lanes < 1 || lanes > 8) return false;
    const expected = Buffer.from(hash, "base64");
    if (!expected.length) return false;
    const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: 2 ** logN, r: rounds, p: lanes, maxmem: MAXMEM });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function validUsername(input: unknown) {
  const username = typeof input === "string" ? input.trim() : "";
  if (username.length < 3 || username.length > 32) throw new Error("Username must be 3 to 32 characters");
  if (!/^[A-Za-z0-9._-]+$/.test(username)) throw new Error("Username can only use letters, numbers, dots, dashes and underscores");
  return username;
}

function validPassword(input: unknown) {
  if (typeof input !== "string" || input.length < 10 || input.length > 200) throw new Error("Password must be 10 to 200 characters");
  return input;
}

function inTransaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function usernameFree(db: DatabaseSync, username: string, exceptId = 0) {
  if (db.prepare("SELECT 1 FROM users WHERE username = ? AND id != ?").get(username, exceptId)) throw new Error("That username is already taken");
}

function addDefaultMatcher(db: DatabaseSync, userId: number) {
  db.prepare("INSERT INTO notification_matchers (user_id, name, enabled, match_severity, match_types) VALUES (?, 'default', 1, '[\"warning\",\"error\"]', '[]')")
    .run(userId);
}

export function createUser(db: DatabaseSync, input: { username: string; password: string }) {
  const username = validUsername(input?.username);
  const hash = hashPassword(validPassword(input?.password));
  return inTransaction(db, () => {
    usernameFree(db, username);
    const id = Number(db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?) RETURNING id").get(username, hash)?.id);
    addDefaultMatcher(db, id);
    recordEvent(db, {
      severity: "info", type: "user.created", actor: "owner", userId: id,
      message: "User created", detail: { username },
    });
    return id;
  });
}

export function deleteUser(db: DatabaseSync, id: number) {
  inTransaction(db, () => {
    if (!db.prepare("SELECT 1 FROM users WHERE id = ?").get(id)) throw new Error("User not found");
    const run = (sql: string) => db.prepare(sql).run(id);
    db.prepare(`DELETE FROM notification_deliveries WHERE target_id IN (SELECT id FROM notification_targets WHERE user_id = $user)
      OR event_id IN (SELECT id FROM events WHERE user_id = $user)`).run({ $user: id });
    db.prepare(`DELETE FROM notification_matcher_targets WHERE matcher_id IN (SELECT id FROM notification_matchers WHERE user_id = $user)
      OR target_id IN (SELECT id FROM notification_targets WHERE user_id = $user)`).run({ $user: id });
    run("DELETE FROM notification_targets WHERE user_id = ?");
    run("DELETE FROM notification_matchers WHERE user_id = ?");
    run("DELETE FROM events WHERE user_id = ?");
    run("DELETE FROM transactions WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)");
    run("DELETE FROM balance_snapshots WHERE account_id IN (SELECT id FROM accounts WHERE user_id = ?)");
    run("DELETE FROM goals WHERE user_id = ?");
    run("DELETE FROM accounts WHERE user_id = ?");
    run("DELETE FROM sync_runs WHERE connection_id IN (SELECT id FROM connections WHERE user_id = ?)");
    run("DELETE FROM connections WHERE user_id = ?");
    run("DELETE FROM budget_limits WHERE user_id = ?");
    run("DELETE FROM budget_months WHERE user_id = ?");
    run("DELETE FROM categories WHERE user_id = ?");
    run("DELETE FROM user_providers WHERE user_id = ?");
    run("DELETE FROM users WHERE id = ?");
  });
}

let dummy: string | undefined;

export function authenticate(db: DatabaseSync, username: string, password: string) {
  const row = db.prepare("SELECT id, session_version, password_hash FROM users WHERE username = ?").get(String(username ?? "").trim());
  const hash = typeof row?.password_hash === "string" ? row.password_hash : (dummy ??= hashPassword("nestegg dummy password"));
  const good = verifyPassword(String(password ?? ""), hash);
  if (!row || !row.password_hash || !good) return null;
  return { id: Number(row.id), session_version: Number(row.session_version) };
}

export function setPassword(db: DatabaseSync, userId: number, current: string, next: string) {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId);
  if (!verifyPassword(String(current ?? ""), row?.password_hash)) throw new Error("The current password is not correct");
  const hash = hashPassword(validPassword(next));
  return inTransaction(db, () => {
    const updated = db.prepare("UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ? RETURNING session_version").get(hash, userId);
    recordEvent(db, { severity: "notice", type: "user.password_changed", actor: "owner", userId, message: "Password changed" });
    return Number(updated?.session_version);
  });
}

export function userById(db: DatabaseSync, id: number) {
  const row = db.prepare("SELECT id, username, currency, primary_color, session_version FROM users WHERE id = ?").get(id);
  return row ? { ...row } as { id: number; username: string | null; currency: string; primary_color: string | null; session_version: number } : undefined;
}

export function userAppearance(db: DatabaseSync, userId: number) {
  const user = db.prepare("SELECT primary_color, color_mode FROM users WHERE id = ?").get(userId);
  return { color: primaryColor(user?.primary_color), mode: parseColorMode(user?.color_mode) ?? "system" };
}

export function setUserAppearance(db: DatabaseSync, userId: number, color: string, mode: ColorMode) {
  db.prepare("UPDATE users SET primary_color = ?, color_mode = ? WHERE id = ?").run(color, mode, userId);
}

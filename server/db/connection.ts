import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import "server-only";
import { initialize } from "./migrations";

export const dataDirectory = process.env.NESTEGG_DATA_DIR ??
  (process.env.NESTEGG_DEMO === "1" ? join(process.cwd(), "data", "demo") : join(process.cwd(), "data"));
let connection: DatabaseSync | undefined;

export function database() {
  if (!connection) {
    mkdirSync(dataDirectory, { recursive: true });
    const db = new DatabaseSync(join(dataDirectory, "nestegg.sqlite"));
    try {
      initialize(db);
      connection = db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  return connection;
}

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initialize } from "../server/db/migrations.ts";
import { adapters } from "../server/imports/providers.ts";
import { syncConnection } from "../server/imports/sync.ts";
import { loadSecretKey } from "../server/secrets.ts";

const directory = process.env.NESTEGG_DATA_DIR ?? join(process.cwd(), "data");
mkdirSync(directory, { recursive: true });
const db = new DatabaseSync(join(directory, "nestegg.sqlite"));
try {
  initialize(db);
  const key = loadSecretKey(directory);
  const only = process.argv[2];
  const rows = db.prepare("SELECT id, label, provider FROM connections WHERE enabled = 1 ORDER BY id").all()
    .filter((row) => !only || String(row.id) === only);
  if (!rows.length) console.log("No enabled connections to sync.");
  for (const row of rows) {
    const adapter = adapters.get(String(row.provider));
    if (!adapter) {
      console.error(`${row.label}: no adapter for ${row.provider}.`);
      process.exitCode = 1;
      continue;
    }
    try {
      const result = await syncConnection(db, key, Number(row.id), adapter, { trigger: "manual" });
      console.log(`${row.label}: ${result.accounts} accounts, ${result.added} added, ${result.updated} updated, ${result.removed} removed.`);
    } catch (error) {
      console.error(`${row.label}: ${error instanceof Error ? error.message : "sync failed"}`);
      process.exitCode = 1;
    }
  }
} finally {
  db.close();
}

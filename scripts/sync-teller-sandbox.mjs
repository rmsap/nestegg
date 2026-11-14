import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createConnection, replaceCredential, setConnectionEnabled } from "../server/connections.ts";
import { initialize } from "../server/db/migrations.ts";
import { adapter } from "../server/imports/providers.ts";
import { syncConnection } from "../server/imports/sync.ts";
import { loadSecretKey } from "../server/secrets.ts";

try {
  const token = process.env.TELLER_SANDBOX_TOKEN ?? "";
  const directory = join(process.cwd(), "data", "teller-sandbox");
  mkdirSync(directory, { recursive: true });
  const key = loadSecretKey(directory);
  const db = new DatabaseSync(join(directory, "nestegg.sqlite"));
  try {
    initialize(db);
    const existing = db.prepare("SELECT id, enabled FROM connections WHERE provider = 'teller' AND label = 'Teller Sandbox'").get();
    let id = Number(existing?.id);
    if (existing) replaceCredential(db, key, id, token);
    else id = createConnection(db, key, { provider: "teller", label: "Teller Sandbox", credential: token });
    if (!existing?.enabled) setConnectionEnabled(db, id, true);
    const result = await syncConnection(db, key, id, adapter("teller"), { trigger: "manual" });
    console.log(`Processed ${result.accounts} accounts: ${result.added} added, ${result.updated} updated, ${result.removed} removed.`);
    console.log("To view them, set NESTEGG_DATA_DIR=data/teller-sandbox before starting Nestegg.");
  } finally {
    db.close();
  }
} catch (error) {
  console.error("Sandbox sync failed.", error instanceof Error ? error.message : "");
  process.exitCode = 1;
}

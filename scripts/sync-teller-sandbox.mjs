import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { initialize } from "../server/db/migrations.ts";
import { syncTransactions } from "../server/imports/sync.ts";
import { tellerSandbox } from "../server/imports/teller-sandbox.ts";

try {
  const provider = tellerSandbox(process.env.TELLER_SANDBOX_TOKEN ?? "");
  const directory = join(process.cwd(), "data", "teller-sandbox");
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, "nestegg.sqlite"));
  try {
    initialize(db);
    const connection = db.prepare("SELECT id FROM connections WHERE provider = 'teller' AND label = 'Teller Sandbox'").get() ??
      db.prepare("INSERT INTO connections (provider, label) VALUES ('teller', 'Teller Sandbox') RETURNING id").get();
    const result = await syncTransactions(db, Number(connection.id), provider);
    console.log(`Processed ${result.accounts} accounts and ${result.transactions} transactions.`);
    console.log("To view them, set NESTEGG_DATA_DIR=data/teller-sandbox before starting Nestegg.");
  } finally {
    db.close();
  }
} catch (error) {
  console.error("Sandbox sync failed.", error instanceof Error ? error.message : "");
  process.exitCode = 1;
}

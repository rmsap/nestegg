import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createConnection, setConnectionEnabled } from "../server/connections/mutations.ts";

test("the demo seed is safe to rerun and the sync CLI selects enabled connections and reports failures", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "nestegg-cli-"));
  const key = randomBytes(32);
  let db;
  t.after(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function run(script, ...args) {
    const path = fileURLToPath(new URL(`./${script}.mjs`, import.meta.url));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", path, ...args], {
      encoding: "utf8",
      env: { ...process.env, NESTEGG_DATA_DIR: directory, NESTEGG_SECRET_KEY: key.toString("base64") },
    });
    if (result.error) throw result.error;
    return result;
  }

  const first = run("seed-demo");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Seeded /);
  db = new DatabaseSync(join(directory, "nestegg.sqlite"));
  db.exec("UPDATE transactions SET memo = 'Keep this memo' WHERE id = 1");
  const second = run("seed-demo");
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /already contains data/);
  assert.equal(db.prepare("SELECT memo FROM transactions WHERE id = 1").get().memo, "Keep this memo");

  const empty = run("sync");
  assert.equal(empty.status, 0, empty.stderr);
  assert.match(empty.stdout, /No enabled connections/);

  const add = (name, scenario) => createConnection(db, 1, key, {
    provider: "demo", label: name, credential: JSON.stringify({ name, scenario, seed: name }),
  });
  const broken = add("Unavailable", "outage");
  const healthy = add("Healthy", "healthy");
  setConnectionEnabled(db, 1, broken, true);
  setConnectionEnabled(db, 1, healthy, true);
  const targeted = run("sync", String(healthy));
  assert.equal(targeted.status, 0, targeted.stderr);
  assert.match(targeted.stdout, /Healthy: 4 accounts/);
  assert.equal(db.prepare("SELECT COUNT(*) AS total FROM sync_runs WHERE connection_id = ?").get(broken).total, 0);

  const all = run("sync");
  assert.equal(all.status, 1);
  assert.match(all.stderr, /Unavailable: The demo bank is unavailable/);
  assert.match(all.stdout, /Healthy: 4 accounts/);
});

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = createRequire(import.meta.url).resolve("@playwright/test/cli");
const directory = mkdtempSync(join(tmpdir(), "nestegg-browser-"));
try {
  const result = spawnSync(process.execPath, [cli, "test", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, NESTEGG_TEST_DATA_DIR: directory },
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, { recursive: true, force: true, maxRetries: 5 });
}

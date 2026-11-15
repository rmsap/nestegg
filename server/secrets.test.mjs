import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { decrypt, encrypt, loadSecretKey } from "./secrets.ts";

test("encrypt and decrypt round-trip, and fail for a wrong key, purpose or tampered payload", () => {
  const key = randomBytes(32);
  const payload = encrypt(key, "connection-credential", "test_token_abc");
  assert.ok(payload.startsWith("v1."));
  assert.ok(!payload.includes("test_token_abc"));
  assert.equal(decrypt(key, "connection-credential", payload), "test_token_abc");
  assert.notEqual(encrypt(key, "connection-credential", "test_token_abc"), payload);
  const message = "Could not decrypt stored secret";
  assert.throws(() => decrypt(randomBytes(32), "connection-credential", payload), { message });
  assert.throws(() => decrypt(key, "notification-secret", payload), { message });
  const parts = payload.split(".");
  const data = Buffer.from(parts[3], "base64url");
  data[0] ^= 1;
  assert.throws(() => decrypt(key, "connection-credential", [...parts.slice(0, 3), data.toString("base64url")].join(".")), { message });
  assert.throws(() => decrypt(key, "connection-credential", parts.slice(0, 3).join(".")), { message });
  assert.throws(() => decrypt(key, "connection-credential", "garbage"), { message });
});

test("loadSecretKey generates a key file once and rejects a malformed environment key", () => {
  const directory = mkdtempSync(join(tmpdir(), "nestegg-key-"));
  const saved = process.env.NESTEGG_SECRET_KEY;
  try {
    delete process.env.NESTEGG_SECRET_KEY;
    const first = loadSecretKey(directory);
    assert.equal(first.length, 32);
    if (process.platform !== "win32") {
      assert.equal(statSync(join(directory, "secret.key")).mode & 0o777, 0o600);
    }
    assert.equal(readFileSync(join(directory, "secret.key"), "utf8"), first.toString("base64"));
    assert.deepEqual(loadSecretKey(directory), first);

    const fromEnv = randomBytes(32);
    process.env.NESTEGG_SECRET_KEY = fromEnv.toString("base64");
    assert.deepEqual(loadSecretKey(directory), fromEnv);
    process.env.NESTEGG_SECRET_KEY = randomBytes(16).toString("base64");
    assert.throws(() => loadSecretKey(directory), /NESTEGG_SECRET_KEY/);
    process.env.NESTEGG_SECRET_KEY = "not base64!";
    assert.throws(() => loadSecretKey(directory), /NESTEGG_SECRET_KEY/);
  } finally {
    if (saved === undefined) delete process.env.NESTEGG_SECRET_KEY;
    else process.env.NESTEGG_SECRET_KEY = saved;
    rmSync(directory, { recursive: true });
  }
});

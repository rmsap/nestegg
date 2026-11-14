import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parse(text: string, source: string) {
  const value = text.trim();
  const key = Buffer.from(value, "base64");
  if (key.length !== 32 || key.toString("base64") !== value) {
    throw new Error(source + " must be the base64 encoding of exactly 32 bytes");
  }
  return key;
}

export function loadSecretKey(dataDirectory: string) {
  if (process.env.NESTEGG_SECRET_KEY) return parse(process.env.NESTEGG_SECRET_KEY, "NESTEGG_SECRET_KEY");
  const path = join(dataDirectory, "secret.key");
  const read = () => parse(readFileSync(path, "utf8"), path);
  try {
    return read();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  mkdirSync(dataDirectory, { recursive: true });
  const key = randomBytes(32);
  try {
    writeFileSync(path, key.toString("base64"), { flag: "wx", mode: 0o600 });
    return key;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return read();
  }
}

function subkey(key: Buffer, purpose: string) {
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), purpose, 32));
}

export function encrypt(key: Buffer, purpose: string, plaintext: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey(key, purpose), iv);
  cipher.setAAD(Buffer.from(purpose));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((part) => typeof part === "string" ? part : part.toString("base64url")).join(".");
}

export function decrypt(key: Buffer, purpose: string, payload: string) {
  try {
    const [version, iv, tag, data, ...extra] = payload.split(".");
    if (version !== "v1" || extra.length || data === undefined) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", subkey(key, purpose), Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Could not decrypt stored secret");
  }
}

export function sign(key: Buffer, purpose: string, data: string) {
  return createHmac("sha256", subkey(key, purpose)).update(data).digest("base64url");
}

export function verify(key: Buffer, purpose: string, data: string, signature: string) {
  const expected = Buffer.from(sign(key, purpose, data));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

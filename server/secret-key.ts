import "server-only";
import { dataDirectory } from "./db/connection";
import { loadSecretKey } from "./secrets";

let key: Buffer | undefined;

export function secretKey() {
  return key ??= loadSecretKey(dataDirectory);
}

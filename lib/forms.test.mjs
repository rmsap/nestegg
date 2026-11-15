import assert from "node:assert/strict";
import { test } from "node:test";
import { readId } from "./forms.ts";

test("form IDs reject malformed and unsafe integers", () => {
  assert.equal(readId("42"), 42);
  assert.equal(readId(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const input of [null, new File([], "id"), "", "-1", "1.2", " 4", "9007199254740992"]) {
    assert.equal(readId(input), 0);
  }
});

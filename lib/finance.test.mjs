import assert from "node:assert/strict";
import { test } from "node:test";
import { money, parseLimit } from "./finance.ts";

test("currency formatting and budget inputs preserve integer cents", () => {
  assert.equal(money(-123456), "-$1,234.56");
  assert.equal(money(0), "$0.00");
  for (const [input, cents] of [["0", 0], ["0.01", 1], ["20.5", 2050], ["1000000", 100000000]]) {
    assert.equal(parseLimit(input), cents);
  }
  for (const input of [null, new File([], "limit"), "", "-1", "0.001", "1e4", " 1", "1000000.01"]) {
    assert.equal(parseLimit(input), null);
  }
});

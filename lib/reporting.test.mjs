import assert from "node:assert/strict";
import { test } from "node:test";
import { demoMonth, monthLabel, parseMonth, reportingMonth } from "./reporting.ts";

test("reporting months validate the calendar month and fall back to the demo period", () => {
  assert.equal(parseMonth("2024-02"), "2024-02");
  assert.equal(reportingMonth("2027-12"), "2027-12");
  assert.equal(monthLabel("2024-02"), "February 2024");
  for (const input of [undefined, ["2024-02"], "0999-01", "2024-2", "2024-00", "2024-13", "2024-02-01"]) {
    assert.equal(parseMonth(input), null);
    assert.equal(reportingMonth(input), demoMonth);
  }
});

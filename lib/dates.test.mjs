import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, dateTime, intervalWords } from "./dates.ts";

test("connection timestamps use local time and preserve invalid input", () => {
  assert.equal(dateTime("2026-11-08T13:30:00"), "Nov 8, 2026, 1:30 PM");
  assert.equal(dateTime("unknown"), "unknown");
});

test("ago and intervalWords read in plain words", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  const before = (ms) => new Date(now.getTime() - ms).toISOString();
  assert.deepEqual([0, 59_000, 60_000, 12 * 60_000, 59 * 60_000, 3_600_000, 3 * 3_600_000, 86_400_000, 2 * 86_400_000]
    .map((ms) => ago(before(ms), now)), ["just now", "just now", "1 min ago", "12 min ago", "59 min ago", "1 hr ago", "3 hr ago", "1 day ago", "2 days ago"]);
  assert.equal(ago(before(-5000), now), "just now");
  assert.equal(ago("2026-10-01T12:00:00.000Z", now), "Oct 1, 2026");
  assert.equal(ago("garbage", now), "garbage");
  assert.deepEqual([1, 30, 60, 360, 90, 1440, 10080].map(intervalWords),
    ["1 minute", "30 minutes", "1 hour", "6 hours", "90 minutes", "1 day", "7 days"]);
});

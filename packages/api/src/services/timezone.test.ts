import assert from "node:assert/strict";
import { test } from "node:test";

// Pure date helpers; the DB-backed getters are covered in history.test.ts.
process.env.SESSION_SECRET ??= "test-session-secret";
process.env.APP_PASSWORD ??= "x";
process.env.DATABASE_PATH ??= ":memory:";
const { dateStart, dayKey, startOfDay, zonedMidnight, isValidTimezone } = await import("./timezone");

const iso = (sec: number) => new Date(sec * 1000).toISOString();

test("midnight in Berlin: winter, summer, and both DST switch days", () => {
  assert.equal(iso(zonedMidnight(2026, 1, 15, "Europe/Berlin")), "2026-01-14T23:00:00.000Z");
  assert.equal(iso(zonedMidnight(2026, 7, 15, "Europe/Berlin")), "2026-07-14T22:00:00.000Z");
  assert.equal(iso(zonedMidnight(2026, 3, 29, "Europe/Berlin")), "2026-03-28T23:00:00.000Z");
  assert.equal(iso(zonedMidnight(2026, 10, 25, "Europe/Berlin")), "2026-10-24T22:00:00.000Z");
  assert.equal(iso(zonedMidnight(2026, 10, 26, "Europe/Berlin")), "2026-10-25T23:00:00.000Z");
});

test("far-off zones and UTC", () => {
  assert.equal(iso(zonedMidnight(2026, 1, 1, "UTC")), "2026-01-01T00:00:00.000Z");
  assert.equal(iso(zonedMidnight(2026, 1, 1, "Pacific/Kiritimati")), "2025-12-31T10:00:00.000Z");
  assert.equal(iso(zonedMidnight(2026, 1, 1, "America/Los_Angeles")), "2026-01-01T08:00:00.000Z");
});

test("dayKey and startOfDay agree around midnight", () => {
  const justAfter = Date.parse("2026-07-14T22:00:30Z") / 1000; // 00:00:30 in Berlin
  assert.equal(dayKey(justAfter, "Europe/Berlin"), "2026-07-15");
  assert.equal(dayKey(justAfter, "UTC"), "2026-07-14");
  assert.equal(iso(startOfDay(justAfter, "Europe/Berlin")), "2026-07-14T22:00:00.000Z");
  assert.equal(iso(dateStart("2026-02-28", "UTC", 1)), "2026-03-01T00:00:00.000Z");
});

test("time zone names are validated", () => {
  assert.ok(isValidTimezone("Europe/Berlin"));
  assert.ok(!isValidTimezone("Mars/Olympus"));
});

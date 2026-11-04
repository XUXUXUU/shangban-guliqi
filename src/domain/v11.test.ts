import test from "node:test";
import assert from "node:assert/strict";
import {
  addCommission,
  dailyMinutes,
  defaults,
  empty,
  profileSnapshot,
  toggleAttendance,
} from "./profile.ts";

const now = new Date(2026, 10, 4, 11);
const profile = {
  ...empty(),
  settings: { ...defaults, salaryCents: 1260000, attendanceCents: 20000 },
};

test("effective hours derive from shift and lunch, with invalid intervals rejected", () => {
  assert.equal(
    dailyMinutes({ ...defaults, shiftStart: "08:00", lunchEnd: "14:00" }),
    480,
  );
  assert.equal(dailyMinutes({ ...defaults, lunchEnd: "19:00" }), null);
  assert.equal(
    dailyMinutes({ ...defaults, lunchStart: "09:00", lunchEnd: "18:00" }),
    null,
  );
});
test("commission uses the local date and timestamp, with idempotent submission", () => {
  const first = addCommission(profile, "300", now, "a");
  assert.deepEqual(first.commissions[0], {
    id: "a",
    dateKey: "2026-11-04",
    amountCents: 30000,
    createdAt: now.getTime(),
  });
  assert.equal(addCommission(first, "300", now, "a"), first);
  const second = addCommission(first, "300", now, "b");
  assert.equal(profileSnapshot(second, now)?.monthlyEarned, 1950);
  assert.equal(profileSnapshot(second, now)?.todayEarned, 150);
  assert.throws(() => addCommission(second, "0", now, "c"));
});
test("attendance adds once and is isolated by month, without changing hourly or today", () => {
  const on = toggleAttendance(profile, now);
  const snapshot = profileSnapshot(on, now);
  assert.equal(snapshot?.monthlyEarned, 1550);
  assert.equal(snapshot?.todayEarned, 150);
  assert.equal(snapshot?.hourlyRate, 75);
  assert.equal(
    profileSnapshot(toggleAttendance(on, now), now)?.monthlyEarned,
    1350,
  );
  assert.equal(
    profileSnapshot(on, new Date(2026, 11, 1, 11))?.attendanceBonus,
    0,
  );
  assert.equal(
    profileSnapshot(JSON.parse(JSON.stringify(on)), now)?.attendanceBonus,
    200,
  );
});
test("archived date overrides are retained but fixed weekly workdays determine earnings", () => {
  const old = { ...profile, overrides: { "2026-11-03": "off" as const } };
  const updated = toggleAttendance(old, now);
  assert.deepEqual(updated.overrides, old.overrides);
  assert.equal(profileSnapshot(updated, now)?.monthlyEarned, 1550);
});

test("recurring payday clamps to the month end without changing the setting", async () => {
  const { paydayInMonth } = await import("./profile.ts");
  assert.equal(paydayInMonth(31, new Date(2026, 1, 1)), 28);
  assert.equal(paydayInMonth(31, new Date(2028, 1, 1)), 29);
  assert.equal(paydayInMonth(31, new Date(2026, 2, 1)), 31);
  assert.equal(paydayInMonth(10, new Date(2026, 1, 1)), 10);
});

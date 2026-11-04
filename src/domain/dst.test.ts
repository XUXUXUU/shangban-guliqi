import test from "node:test";
import assert from "node:assert/strict";
import { getSnapshot } from "./earnings.ts";

test("spring gap does not create phantom work or change a sealed day after midnight", () => {
  const previousZone = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const settings = {
      salaryCny: 2000,
      weekdays: [7],
      shiftStart: "01:00",
      lunchStart: "02:30",
      lunchEnd: "03:15",
      shiftEnd: "05:00",
    };
    const beforeClose = getSnapshot(new Date("2026-03-08T03:00"), settings);
    assert.equal(beforeClose.status, "lunch");
    assert.equal(beforeClose.todayWorkedHours, 1);
    const afterClose = getSnapshot(new Date("2026-03-08T05:00"), settings);
    assert.equal(afterClose.todayWorkedHours, 2.75);
    assert.equal(afterClose.todayEarned, 400);
    assert.equal(
      getSnapshot(new Date("2026-03-09T00:00"), settings).monthlyEarned,
      afterClose.monthlyEarned,
    );
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fixtures from "../../data/acceptance-fixtures.json" with { type: "json" };
import { getSnapshot } from "./earnings.ts";
import type { Overrides } from "./earnings.ts";
import { cents } from "./profile.ts";

for (const row of fixtures.cases)
  test(row.id, () => {
    const q = getSnapshot(
      new Date(row.atLocal),
      fixtures.base,
      row.overrides as Overrides | undefined,
      row.pauses?.map((p) => ({
        dateKey: p.dateKey,
        startedAt: new Date(p.startLocal).toISOString(),
        endedAt: new Date(p.endLocal).toISOString(),
      })),
      row.commissions,
    );
    for (const [key, value] of Object.entries(row.expected)) {
      const actual =
        q[(key === "monthEarned" ? "monthlyEarned" : key) as keyof typeof q];
      if (typeof value === "number" && typeof actual === "number")
        assert.ok(Math.abs(value - actual) < 1e-8);
      else assert.equal(actual, value);
    }
  });
test("lunch takes precedence; an open pause resumes after lunch", () => {
  const pause = [
    {
      dateKey: "2026-11-04",
      startedAt: new Date("2026-11-04T11:50").toISOString(),
      endedAt: null,
    },
  ];
  const at = (t: string) =>
    getSnapshot(new Date("2026-11-04T" + t), fixtures.base, {}, pause);
  assert.equal(at("12:00").status, "lunch");
  assert.equal(at("13:00").status, "paused");
  assert.equal(at("17:59").todayEarned, 212.5);
});
test("money input uses integer cents", () => {
  assert.equal(cents("19.29"), 1929);
  assert.throws(() => cents("1.001"));
  assert.throws(() => cents("0.00"));
});

test("updating and removing a commission changes only the month balance", () => {
  const date = new Date("2026-11-04T11:00:00");
  for (const [commissions, balance] of [
    [[{ dateKey: "2026-11-03", amountCny: 200 }], 1550],
    [[{ dateKey: "2026-11-03", amountCny: 300.29 }], 1650.29],
    [[], 1350],
  ] as const) {
    const q = getSnapshot(date, fixtures.base, {}, [], [...commissions]);
    assert.equal(q.todayEarned, 150);
    assert.equal(q.hourlyRate, 75);
    assert.equal(q.monthlyEarned, balance);
  }
});

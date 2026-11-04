import assert from "node:assert/strict";
import test from "node:test";
import { getSnapshot } from "./earnings.ts";
import { advanceGoal, motivation, goalPool, makeGoal } from "./motivation.ts";
import { defaults, rules } from "./profile.ts";

const settings = rules({ ...defaults, salaryCents: 1260000 });
const now = new Date(2026, 10, 4, 11, 50);
const q = getSnapshot(now, settings, {}, [], []);
const coffee = makeGoal("coffee", "一杯拿铁", "22.50");
const taxi = makeGoal("taxi", "一次打车", "81.25");
const pool = [coffee, taxi];

test("goal starts at the current worked time and counts only effective work", () => {
  const active = advanceGoal(null, q, pool);
  assert.equal(
    motivation(now, settings, q, coffee, active),
    "再过 18 分钟，一杯拿铁就赚回来了。",
  );
  const afternoon = new Date(2026, 10, 4, 13, 1);
  const afternoonSnapshot = getSnapshot(afternoon, settings, {}, [], []);
  assert.equal(advanceGoal(active, afternoonSnapshot, pool), active);
  assert.equal(
    motivation(afternoon, settings, afternoonSnapshot, coffee, active),
    "再过 7 分钟，一杯拿铁就赚回来了。",
  );
  const lunch = new Date(2026, 10, 4, 12, 10);
  const lunchSnapshot = getSnapshot(lunch, settings, {}, [], []);
  assert.doesNotMatch(
    motivation(lunch, settings, lunchSnapshot, coffee, active),
    /再过|就赚回来了/,
  );
  const paused = { ...q, status: "paused" as const };
  assert.equal(advanceGoal(active, paused, pool), active);
  assert.doesNotMatch(
    motivation(now, settings, paused, coffee, active),
    /再过|就赚回来了/,
  );
});

test("rate and price change the countdown; completion and deletion advance without repeating", () => {
  const active = advanceGoal(null, q, pool);
  assert.equal(
    motivation(now, settings, { ...q, hourlyRate: 150 }, coffee, active),
    "再过 9 分钟，一杯拿铁就赚回来了。",
  );
  assert.equal(
    motivation(now, settings, q, { ...coffee, priceCents: 4500 }, active),
    "再过 36 分钟，一杯拿铁就赚回来了。",
  );
  assert.doesNotMatch(
    motivation(now, settings, { ...q, hourlyRate: 0 }, coffee, active),
    /NaN|Infinity|再过/,
  );
  const afterCompletion = { ...q, todayWorkedHours: q.todayWorkedHours + 0.31 };
  const next = advanceGoal(active, afterCompletion, pool);
  assert.equal(next?.id, taxi.id);
  assert.equal(advanceGoal(active, q, [taxi])?.id, taxi.id);
  assert.equal(advanceGoal(active, q, []), null);
  assert.equal(advanceGoal(active, q, [coffee])?.id, coffee.id);
  assert.equal(advanceGoal(active, afterCompletion, [coffee]), active);
  assert.match(
    motivation(now, settings, q, { ...coffee, priceCents: 200000 }, active),
    /^还需要约 .+ 个工作日，/,
  );
});

test("custom names and prices validate and user targets are interleaved with built-ins", () => {
  assert.deepEqual(makeGoal("car", " 一次洗车 ", "80.01"), {
    id: "custom:car",
    name: "一次洗车",
    priceCents: 8001,
  });
  for (const price of [
    "0",
    "-3",
    "NaN",
    "Infinity",
    "0.001",
    "1000000",
    "1e2",
  ]) {
    assert.throws(() => makeGoal("car", "一次洗车", price));
  }
  assert.throws(() => makeGoal("car", " ", "2"));
  assert.throws(() => makeGoal("car", "超".repeat(25), "2"));
  assert.equal(goalPool([coffee, taxi])[0], coffee);
  assert.equal(goalPool([coffee, taxi])[2], taxi);
  assert.notEqual(goalPool([]).length, 0);
});

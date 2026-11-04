import bank from "../../data/motivations.json";
import { workSegments } from "./earnings.ts";
import type { getSnapshot, Settings } from "./earnings.ts";

export function duration(ms: number) {
  const min = Math.max(0, Math.ceil(ms / 60000));
  return min > 59
    ? `${Math.floor(min / 60)} 小时 ${min % 60} 分钟`
    : `${min} 分钟`;
}

export function motivation(
  now: Date,
  s: Settings,
  q: ReturnType<typeof getSnapshot>,
  leave: boolean,
) {
  const slot = Math.floor(now.getTime() / 1_200_000);
  if (q.status !== "working") {
    const list = bank.stateTemplates[leave ? "unpaid_leave" : q.status];
    return list[slot % list.length].text;
  }
  const t = now.getTime();
  const ranges = workSegments(now, s)
    .map(([a, b]) => [Math.max(a, t), b])
    .filter(([a, b]) => a < b);
  const left = ranges.reduce((n, [a, b]) => n + b - a, 0);
  const attainable = bank.targets.filter(
    (g) =>
      g.priceCny > q.todayEarned &&
      g.priceCny <=
        Math.min(q.dailyBase, q.todayEarned + (left * q.hourlyRate) / 3600000),
  );
  if (attainable.length) {
    const g = attainable[slot % Math.min(attainable.length, 3)];
    let needed = ((g.priceCny - q.todayEarned) * 3600000) / q.hourlyRate;
    for (const [a, b] of ranges) {
      if (needed <= b - a)
        return bank.workingTemplates[[0, 3, 5, 9][slot % 4]].text
          .replace("{time}", duration(a + needed - t))
          .replace("{target}", g.name);
      needed -= b - a;
    }
  }
  const reached = bank.targets.findLast((g) => g.priceCny <= q.todayEarned);
  return reached
    ? bank.completedTemplates[slot % 5].text.replace("{target}", reached.name)
    : "今天的工作进度已经记下。";
}

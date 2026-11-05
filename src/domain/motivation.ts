import bank from "../../data/motivations.json" with { type: "json" };
import { workSegments } from "./earnings.ts";
import type { getSnapshot, Settings } from "./earnings.ts";
import { cents } from "./profile.ts";

export type Goal = { id: string; name: string; priceCents: number };
export type GoalOverrides = Record<string, Omit<Goal, "id">>;
export type GoalProgress = { id: string; date: string; startHours: number };
type Snapshot = ReturnType<typeof getSnapshot>;

export const builtInGoals: readonly Goal[] = bank.targets.map((g) => ({
  id: `builtin:${g.id}`,
  name: g.name,
  priceCents: Math.round(g.priceCny * 100),
}));

export function makeGoal(id: string, name: string, price: string): Goal {
  name = name.trim();
  const length = Array.from(name).length;
  if (length < 2 || length > 24 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new Error("目标名称须为 2–24 个字符。");
  }
  const priceCents = cents(price.trim());
  if (priceCents > 99_999_999)
    throw new Error("价格须在 ¥0.01–¥999,999.99 之间。");
  return {
    id: id.startsWith("custom:") || id.startsWith("builtin:")
      ? id
      : `custom:${id}`,
    name,
    priceCents,
  };
}

export function effectiveBuiltInGoals(overrides: GoalOverrides = {}): Goal[] {
  const active = new Set(builtInGoals.map((goal) => goal.id));
  const catalog = builtInGoals.map((goal) => ({ ...goal, ...overrides[goal.id] }));
  // An old built-in item may disappear from a new catalog. Keep the user's edited
  // version visible, rather than dropping a paid-for/personalized preference.
  const legacy = Object.entries(overrides)
    .filter(([id]) => id.startsWith("builtin:") && !active.has(id))
    .map(([id, details]) => ({ id, ...details }));
  return [...catalog, ...legacy];
}

export function goalPool(
  custom: readonly Goal[],
  overrides?: GoalOverrides,
  hiddenBuiltInGoalIds: readonly string[] = [],
): Goal[] {
  const hidden = new Set(hiddenBuiltInGoalIds);
  const builtIn = effectiveBuiltInGoals(overrides).filter((goal) => !hidden.has(goal.id));
  return Array.from(
    { length: Math.max(custom.length, builtIn.length) },
    (_, i) => [custom[i], builtIn[i]].filter(Boolean),
  ).flat();
}

const remainingHours = (q: Snapshot, g: Goal, progress: GoalProgress) =>
  g.priceCents / 100 / q.hourlyRate -
  Math.max(0, q.todayWorkedHours - progress.startHours);

export function advanceGoal(
  previous: GoalProgress | null,
  q: Snapshot,
  goals: readonly Goal[],
): GoalProgress | null {
  if (q.status !== "working") return previous;
  if (!goals.length || !Number.isFinite(q.hourlyRate) || q.hourlyRate <= 0)
    return null;
  const index = previous ? goals.findIndex((g) => g.id === previous.id) : -1;
  if (
    previous &&
    previous.date === q.dateKey &&
    index >= 0 &&
    previous.startHours <= q.todayWorkedHours
  ) {
    if (remainingHours(q, goals[index], previous) > 1e-9 || goals.length === 1)
      return previous;
  }
  const next = goals[(index + 1) % goals.length];
  return { id: next.id, date: q.dateKey, startHours: q.todayWorkedHours };
}

function duration(hours: number) {
  const minutes = Math.max(1, Math.ceil(hours * 60 - 1e-7));
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ""}`;
}

export function motivation(
  now: Date,
  s: Settings,
  q: Snapshot,
  goal?: Goal,
  progress?: GoalProgress | null,
) {
  if (q.status !== "working") return bank.stateTemplates[q.status][0].text;
  if (
    !goal ||
    !progress ||
    progress.date !== q.dateKey ||
    !Number.isFinite(q.hourlyRate) ||
    q.hourlyRate <= 0
  ) {
    return "今天的工作进度已经记下。";
  }
  const needed = remainingHours(q, goal, progress);
  if (needed <= 1e-9) return `${goal.name}已经赚回来了。`;
  const hoursLeft = workSegments(now, s).reduce(
    (hours, [start, end]) =>
      hours + Math.max(0, end - Math.max(start, now.getTime())) / 3_600_000,
    0,
  );
  if (needed <= hoursLeft + 1e-9)
    return `再过 ${duration(needed)}，${goal.name}就赚回来了。`;
  const workdays = Math.ceil((needed / q.scheduledHours) * 10) / 10;
  return `还需要约 ${workdays.toLocaleString("zh-CN")} 个工作日，${goal.name}就赚回来了。`;
}

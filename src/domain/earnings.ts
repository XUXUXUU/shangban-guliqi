export type Settings = {
  salaryCny: number;
  weekdays: number[];
  shiftStart: string;
  shiftEnd: string;
  lunchStart: string;
  lunchEnd: string;
};
export type Kind = "work" | "off" | "unpaid_leave";
export type Overrides = Record<string, Kind>;
export type Pause = {
  dateKey: string;
  startedAt: string | number;
  endedAt: string | number | null;
};
export type Commission = { dateKey: string; amountCny: number };
type Range = [number, number];
/**
 * 上班鼓励器 V1 纯函数核算，不依赖 Tauri、DOM、计时器或数据库。
 * months are 1-based; weekdays Mon=1..Sun=7.
 */
export const dayKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export const weekday = (date: Date) =>
  date.getDay() === 0 ? 7 : date.getDay();
const timeParts = (value: string): [number, number] => {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error(`Invalid time ${value}`);
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) throw new Error(`Invalid time ${value}`);
  return [h, m];
};
export const minuteOfDay = (time: string) => {
  const [h, m] = timeParts(time);
  return h * 60 + m;
};
export const at = (date: Date, time: string) => {
  const [h, m] = timeParts(time);
  const resolved = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    h,
    m,
    0,
    0,
  );
  if (resolved.getHours() === h && resolved.getMinutes() === m) {
    return resolved.getTime();
  }
  // During a DST gap Date shifts forward by the offset change. Clamp any
  // nonexistent boundary to the first valid instant after the gap.
  const intended = h * 60 + m;
  let instant = resolved.getTime();
  for (let count = 0; count < 1440; count++) {
    const previous = new Date(instant - 60_000);
    if (
      dayKey(previous) !== dayKey(date) ||
      previous.getHours() * 60 + previous.getMinutes() < intended
    )
      break;
    instant = previous.getTime();
  }
  return instant;
};
const makeDate = (year: number, month: number, day: number) =>
  new Date(year, month - 1, day, 12, 0, 0); // noon to avoid DST midnight oddities
const overlap = (a1: number, a2: number, b1: number, b2: number) =>
  Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const dateOverrideKind = (date: Date, overrides: Overrides = {}) =>
  overrides[dayKey(date)] || null;

export function validateSettings(settings: Settings) {
  if (!Number.isFinite(settings.salaryCny) || settings.salaryCny <= 0)
    throw new Error("salary must be positive");
  const salaryCents = Math.round(settings.salaryCny * 100);
  if (
    !Number.isSafeInteger(salaryCents) ||
    salaryCents / 100 !== settings.salaryCny
  )
    throw new Error("salary has more than 2 decimals");
  if (
    !Array.isArray(settings.weekdays) ||
    settings.weekdays.length === 0 ||
    new Set(settings.weekdays).size !== settings.weekdays.length ||
    settings.weekdays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)
  )
    throw new Error("weekdays missing or invalid");
  validateShift(settings);
  return true;
}

export function validateShift(
  settings: Pick<
    Settings,
    "shiftStart" | "shiftEnd" | "lunchStart" | "lunchEnd"
  >,
) {
  const start = minuteOfDay(settings.shiftStart);
  const end = minuteOfDay(settings.shiftEnd);
  const lunch = minuteOfDay(settings.lunchStart);
  const resume = minuteOfDay(settings.lunchEnd);
  if (!(
    start <= lunch &&
    lunch < resume &&
    resume <= end &&
    end - start > resume - lunch
  ))
    throw new Error("午休须在班次内，有效工时须大于零。");
}

export function isPlannedWorkday(
  date: Date,
  settings: Settings,
  overrides: Overrides = {},
) {
  const kind = dateOverrideKind(date, overrides);
  if (kind === "work" || kind === "unpaid_leave") return true;
  if (kind === "off") return false;
  return settings.weekdays.includes(weekday(date));
}
export function isIncomeWorkday(
  date: Date,
  settings: Settings,
  overrides: Overrides = {},
) {
  return (
    isPlannedWorkday(date, settings, overrides) &&
    dateOverrideKind(date, overrides) !== "unpaid_leave"
  );
}
export function monthlyPlannedDays(
  year: number,
  month: number,
  settings: Settings,
  overrides: Overrides = {},
) {
  const n = new Date(year, month, 0).getDate();
  return Array.from({ length: n }, (_, i) =>
    isPlannedWorkday(makeDate(year, month, i + 1), settings, overrides),
  ).filter(Boolean).length;
}
export function workSegments(date: Date, settings: Settings) {
  return (
    [
      [at(date, settings.shiftStart), at(date, settings.lunchStart)],
      [at(date, settings.lunchEnd), at(date, settings.shiftEnd)],
    ] as Range[]
  ).filter(([a, b]) => b > a);
}
function mergedPauses(
  date: Date,
  untilMs: number,
  settings: Settings,
  pauses: Pause[] = [],
) {
  const datekey = dayKey(date),
    segments = workSegments(date, settings);
  const dayEnd = Math.max(...segments.map((x) => x[1]));
  const raw = pauses
    .filter((p) => p.dateKey === datekey)
    .map((p) => [
      new Date(p.startedAt).getTime(),
      p.endedAt !== null ? new Date(p.endedAt).getTime() : dayEnd,
    ])
    .map(([a, b]) => [a, Math.min(b, untilMs, dayEnd)])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .sort((a, b) => a[0] - b[0]);
  const merge: Range[] = [];
  for (const [a, b] of raw) {
    const last = merge.at(-1);
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merge.push([a, b]);
  }
  return merge;
}
export function workedMilliseconds(
  date: Date,
  now: Date,
  settings: Settings,
  overrides: Overrides = {},
  pauses: Pause[] = [],
) {
  if (!isIncomeWorkday(date, settings, overrides)) return 0;
  const until = now.getTime();
  const segments = workSegments(date, settings);
  const pauseRanges = mergedPauses(date, until, settings, pauses);
  return sum(
    segments.map(([start, end]) => {
      const visibleEnd = Math.min(end, until);
      if (visibleEnd <= start) return 0;
      return Math.max(
        0,
        visibleEnd -
          start -
          sum(pauseRanges.map(([a, b]) => overlap(start, visibleEnd, a, b))),
      );
    }),
  );
}
export type Status =
  "working" | "paused" | "pre_work" | "lunch" | "off_work" | "rest_day";
export function statusAt(
  now: Date,
  settings: Settings,
  overrides: Overrides = {},
  pauses: Pause[] = [],
): Status {
  if (!isIncomeWorkday(now, settings, overrides)) return "rest_day";
  const t = now.getTime();
  if (t < at(now, settings.shiftStart)) return "pre_work";
  if (t >= at(now, settings.shiftEnd)) return "off_work";
  if (t >= at(now, settings.lunchStart) && t < at(now, settings.lunchEnd))
    return "lunch";
  const hasOpenPause = pauses.some(
    (p) =>
      p.dateKey === dayKey(now) &&
      p.endedAt === null &&
      new Date(p.startedAt).getTime() <= t,
  );
  if (hasOpenPause) return "paused";
  return "working";
}
export function getSnapshot(
  now: Date,
  settings: Settings,
  overrides: Overrides = {},
  pauses: Pause[] = [],
  commissions: Commission[] = [],
) {
  validateSettings(settings);
  const year = now.getFullYear(),
    month = now.getMonth() + 1,
    today = now.getDate();
  const planned = monthlyPlannedDays(year, month, settings, overrides);
  if (planned <= 0) throw new Error("No planned working days this month");
  const nominalMs = scheduledMinutes(settings) * 60_000;
  const capacity = (date: Date) =>
    sum(workSegments(date, settings).map(([start, end]) => end - start)) ||
    nominalMs;
  const dailyMs = capacity(now);
  const dailyBase = settings.salaryCny / planned;
  const hourlyRate = dailyBase / (dailyMs / 3_600_000);
  const todayMs = workedMilliseconds(now, now, settings, overrides, pauses);
  const todayEarned = (dailyBase * todayMs) / dailyMs;
  let monthBase = todayEarned;
  for (let d = 1; d < today; d++) {
    const date = makeDate(year, month, d);
    const work = workedMilliseconds(date, now, settings, overrides, pauses);
    if (work > 0) monthBase += (dailyBase * work) / capacity(date);
  }
  const todayKey = dayKey(now);
  const commissionTotal =
    sum(
      commissions
        .filter(
          (c) =>
            c.dateKey.startsWith(todayKey.slice(0, 7) + "-") &&
            c.dateKey <= todayKey,
        )
        .map((c) => Math.round(c.amountCny * 100)),
    ) / 100;
  return {
    dateKey: todayKey,
    plannedDays: planned,
    dailyBase,
    hourlyRate,
    scheduledHours: dailyMs / 3_600_000,
    todayWorkedHours: todayMs / 3_600_000,
    progress: Math.min(1, Math.max(0, todayMs / dailyMs)),
    todayEarned,
    monthlyBaseEarned: monthBase,
    monthlyCommissionEarned: commissionTotal,
    monthlyEarned: monthBase + commissionTotal,
    displayedTodayEarned: todayEarned.toFixed(4),
    displayedMonthlyEarned: money(monthBase + commissionTotal).toFixed(2),
    status: statusAt(now, settings, overrides, pauses),
  };
}

export const scheduledMinutes = (s: Parameters<typeof validateShift>[0]) =>
  minuteOfDay(s.shiftEnd) -
  minuteOfDay(s.shiftStart) -
  minuteOfDay(s.lunchEnd) +
  minuteOfDay(s.lunchStart);

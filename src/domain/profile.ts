import {
  dayKey,
  getSnapshot,
  validateShift,
  scheduledMinutes,
  validateSettings,
} from "./earnings.ts";
import type { Settings, Overrides, Pause } from "./earnings.ts";
import type { Goal, GoalOverrides } from "./motivation.ts";

export type Rules = Omit<Settings, "salaryCny"> & {
  salaryCents: number;
  payday: number;
  attendanceCents?: number;
};
export type Entry = {
  id: string;
  dateKey: string;
  amountCents: number;
  note?: string;
  createdAt?: number;
};
export type Profile = {
  settings: Rules | null;
  onboardingCompleted?: boolean;
  overrides: Overrides;
  pauses: Pause[];
  commissions: Entry[];
  pinned: boolean;
  theme?: "light" | "dark";
  attendanceMonths?: Record<string, boolean>;
  customGoals?: Goal[];
  builtInGoalOverrides?: GoalOverrides;
};
export const empty = (): Profile => ({
  settings: null,
  onboardingCompleted: false,
  overrides: {},
  pauses: [],
  commissions: [],
  pinned: false,
});
export const defaults: Rules = {
  salaryCents: 0,
  payday: 10,
  weekdays: [1, 2, 3, 4, 5],
  shiftStart: "09:00",
  shiftEnd: "18:00",
  lunchStart: "12:00",
  lunchEnd: "13:00",
};
export const rules = (r: Rules): Settings => ({
  ...r,
  salaryCny: r.salaryCents / 100,
});
export function cents(raw: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(raw))
    throw new Error("请输入大于零的金额，最多两位小数。");
  const [yuan, fraction = ""] = raw.split(".");
  const n = Number(yuan) * 100 + Number(fraction.padEnd(2, "0"));
  if (n <= 0 || n > 99999999999 || !Number.isSafeInteger(n))
    throw new Error("金额超出范围。");
  return n;
}
export function checked(r: Rules) {
  if (!Number.isInteger(r.payday) || r.payday < 1 || r.payday > 31)
    throw new Error("发薪日须为 1–31 日。");
  if (!r.weekdays.length) throw new Error("至少选择一个工作日。");
  validateSettings(rules(r));
}
export function dailyMinutes(r: Rules) {
  try {
    validateShift(r);
    return scheduledMinutes(r);
  } catch {
    return null;
  }
}
export function hours(r: Rules) {
  const minutes = dailyMinutes(r);
  if (minutes === null) return "—";
  const whole = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [whole ? `${whole} 小时` : "", rest ? `${rest} 分钟` : ""]
    .filter(Boolean)
    .join(" ");
}
export function addCommission(
  p: Profile,
  amount: string,
  now: Date,
  id: string,
): Profile {
  if (p.commissions.some((entry) => entry.id === id)) return p;
  const entry = {
    id,
    dateKey: dayKey(now),
    amountCents: cents(amount),
    createdAt: now.getTime(),
  };
  return { ...p, commissions: [...p.commissions, entry] };
}
export const monthKey = (now: Date) => dayKey(now).slice(0, 7);
export function toggleAttendance(p: Profile, now: Date): Profile {
  const month = monthKey(now);
  return {
    ...p,
    attendanceMonths: {
      ...p.attendanceMonths,
      [month]: !(p.attendanceMonths?.[month] ?? true),
    },
  };
}
export function profileSnapshot(p: Profile, now: Date) {
  if (!p.settings) return null;
  const q = getSnapshot(
    now,
    rules(p.settings),
    {},
    p.pauses,
    p.commissions.map((c) => ({
      dateKey: c.dateKey,
      amountCny: c.amountCents / 100,
    })),
  );
  const attendanceOn = p.attendanceMonths?.[monthKey(now)] ?? true;
  const attendanceAmount = (p.settings.attendanceCents ?? 0) / 100;
  const attendanceBonus = attendanceOn ? attendanceAmount : 0;
  return {
    ...q,
    attendanceOn,
    attendanceAmount,
    attendanceBonus,
    monthlyEarned: q.monthlyEarned + attendanceBonus,
  };
}

/** The recurring setting is kept intact when a month is shorter. */
export function paydayInMonth(day: number, now: Date): number {
  return Math.min(
    day,
    new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
  );
}

export function needsOnboarding(p: Profile): boolean {
  return (
    !p.settings ||
    p.settings.salaryCents <= 0 ||
    p.onboardingCompleted === false
  );
}

export function daysToPayday(day: number, now: Date): number {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const due = paydayInMonth(day, now);
  if (due >= today) return due - today;
  const next = new Date(year, month + 1, 1);
  const endOfMonth = new Date(year, month + 1, 0).getDate();
  return endOfMonth - today + paydayInMonth(day, next);
}

export function daysToSaturday(now: Date): number {
  return (6 - now.getDay() + 7) % 7;
}

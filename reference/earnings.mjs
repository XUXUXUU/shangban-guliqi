/**
 * 上班鼓励器 V1 纯函数核算示例；不依赖 Tauri、DOM、计时器或数据库。
 * 仅供 Codex 移植至严格 TS 并接入真实数据模型，生产版须补充跨时区/DST 测试。
 * months are 1-based; weekdays Mon=1..Sun=7.
 */
export const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const weekday = (date) => (date.getDay() === 0 ? 7 : date.getDay());
const timeParts = (value) => {
  if (!/^\d{2}:\d{2}$/.test(value)) throw new Error(`Invalid time ${value}`);
  const [h, m] = value.split(':').map(Number);
  if (h > 23 || m > 59) throw new Error(`Invalid time ${value}`);
  return [h, m];
};
const minuteOfDay = (time) => { const [h,m] = timeParts(time); return h*60+m; };
const at = (date, time) => { const [h, m] = timeParts(time); return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0, 0).getTime(); };
const makeDate = (year, month, day) => new Date(year, month-1, day, 12, 0, 0); // noon to avoid DST midnight oddities
const overlap = (a1,a2,b1,b2) => Math.max(0,Math.min(a2,b2)-Math.max(a1,b1));
const sum = (xs) => xs.reduce((a,b)=>a+b,0);
const money = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const dateOverrideKind = (date, overrides={}) => overrides[dayKey(date)] || null;

export function validateSettings(settings) {
  if (!Number.isFinite(settings.salaryCny) || settings.salaryCny <= 0) throw new Error('salary must be positive');
  if (!Number.isInteger(Math.round(settings.salaryCny * 100)) || Math.abs(settings.salaryCny*100 - Math.round(settings.salaryCny*100)) > 1e-6) throw new Error('salary has more than 2 decimals');
  if (!Array.isArray(settings.weekdays) || settings.weekdays.length === 0 || settings.weekdays.some(d=>!Number.isInteger(d)||d<1||d>7)) throw new Error('weekdays missing or invalid');
  const a=minuteOfDay(settings.shiftStart), b=minuteOfDay(settings.lunchStart), c=minuteOfDay(settings.lunchEnd), d=minuteOfDay(settings.shiftEnd);
  if (!(a <= b && b < c && c <= d && a < d)) throw new Error('Invalid work or lunch interval');
  if (d-a-(c-b) <= 0) throw new Error('Daily hours must be >0');
  return true;
}

export function isPlannedWorkday(date, settings, overrides={}) {
  const kind=dateOverrideKind(date,overrides);
  if (kind === 'work' || kind === 'unpaid_leave') return true;
  if (kind === 'off') return false;
  return settings.weekdays.includes(weekday(date));
}
export function isIncomeWorkday(date, settings, overrides={}) {
  return isPlannedWorkday(date, settings, overrides) && dateOverrideKind(date,overrides) !== 'unpaid_leave';
}
export function monthlyPlannedDays(year, month, settings, overrides={}) {
  const n = new Date(year, month, 0).getDate();
  return Array.from({length:n},(_,i)=>isPlannedWorkday(makeDate(year,month,i+1), settings, overrides)).filter(Boolean).length;
}
export function workSegments(date, settings) {
  return [[at(date,settings.shiftStart),at(date,settings.lunchStart)],[at(date,settings.lunchEnd),at(date,settings.shiftEnd)]].filter(([a,b])=>b>a);
}
function mergedPauses(date, untilMs, settings, pauses=[]) {
  const datekey=dayKey(date), segments=workSegments(date,settings);
  const dayEnd=Math.max(...segments.map(x=>x[1]));
  const raw=pauses.filter(p=>p.dateKey===datekey).map(p=>[
    new Date(p.startedAt).getTime(),
    p.endedAt ? new Date(p.endedAt).getTime() : dayEnd
  ]).map(([a,b])=>[a,Math.min(b,untilMs,dayEnd)]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);
  const merge=[];
  for(const [a,b] of raw){ const last=merge.at(-1); if(last && a<=last[1]) last[1]=Math.max(last[1],b); else merge.push([a,b]); }
  return merge;
}
export function workedMilliseconds(date, now, settings, overrides={}, pauses=[]) {
  if (!isIncomeWorkday(date,settings,overrides)) return 0;
  const until=now.getTime();
  const segments=workSegments(date,settings);
  const pauseRanges=mergedPauses(date,until,settings,pauses);
  return sum(segments.map(([start,end])=>{
    const visibleEnd=Math.min(end,until);
    if(visibleEnd<=start) return 0;
    return Math.max(0,visibleEnd-start-sum(pauseRanges.map(([a,b])=>overlap(start,visibleEnd,a,b))));
  }));
}
export function statusAt(now,settings,overrides={},pauses=[]) {
  if(!isIncomeWorkday(now,settings,overrides)) return 'rest_day';
  const t=now.getTime();
  if(t<at(now,settings.shiftStart)) return 'pre_work';
  if(t>=at(now,settings.shiftEnd)) return 'off_work';
  if(t>=at(now,settings.lunchStart) && t<at(now,settings.lunchEnd)) return 'lunch';
  const currentPauses=pauses.filter(p=>p.dateKey===dayKey(now) && !p.endedAt && new Date(p.startedAt).getTime()<=t);
  if(currentPauses.length>0) return 'paused';
  return 'working';
}
export function getSnapshot(now, settings, overrides={}, pauses=[], commissions=[]) {
  validateSettings(settings);
  const year=now.getFullYear(), month=now.getMonth()+1, today=now.getDate();
  const planned=monthlyPlannedDays(year,month,settings,overrides);
  if(planned<=0) throw new Error('No planned working days this month');
  const segs=workSegments(makeDate(year,month,1),settings);
  const dailyMs=sum(segs.map(([a,b])=>b-a));
  if (dailyMs<=0) throw new Error('No work minutes');
  const dailyBase=settings.salaryCny/planned;
  const hourlyRate=dailyBase/(dailyMs/3_600_000);
  const todayMs=workedMilliseconds(now,now,settings,overrides,pauses);
  let monthBase=0;
  for(let d=1;d<=today;d++) {
    const date=makeDate(year,month,d);
    monthBase+=dailyBase * (workedMilliseconds(date,now,settings,overrides,pauses)/dailyMs);
  }
  const todayKey=dayKey(now);
  const commissionTotal=sum(commissions.filter(c=>typeof c.dateKey==='string' && c.dateKey.startsWith(`${year}-${String(month).padStart(2,'0')}-`) && c.dateKey<=todayKey).map(c=>c.amountCny));
  return {
    dateKey:todayKey,
    plannedDays:planned,
    dailyBase,
    hourlyRate,
    scheduledHours:dailyMs/3_600_000,
    todayWorkedHours:todayMs/3_600_000,
    progress:Math.min(1,Math.max(0,todayMs/dailyMs)),
    todayEarned:dailyBase * todayMs/dailyMs,
    monthlyBaseEarned:monthBase,
    monthlyCommissionEarned:commissionTotal,
    monthlyEarned:monthBase+commissionTotal,
    displayedTodayEarned:(dailyBase * todayMs/dailyMs).toFixed(4),
    displayedMonthlyEarned:money(monthBase+commissionTotal).toFixed(2),
    status:statusAt(now,settings,overrides,pauses)
  };
}

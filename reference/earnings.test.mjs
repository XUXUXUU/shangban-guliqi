import test from 'node:test';
import assert from 'node:assert/strict';
import {getSnapshot,monthlyPlannedDays,statusAt,validateSettings} from './earnings.mjs';

const s={salaryCny:12600, weekdays:[1,2,3,4,5],shiftStart:'09:00',lunchStart:'12:00',lunchEnd:'13:00',shiftEnd:'18:00'};
const at=(day,h,m=0)=>new Date(2026,10,day,h,m,0,0);
const approx=(a,b,delta=1e-6)=>assert.ok(Math.abs(a-b)<delta,`${a} not close to ${b}`);
const pause=(day,h1,m1,h2,m2)=>({dateKey:`2026-11-${String(day).padStart(2,'0')}`,startedAt:at(day,h1,m1).toISOString(),endedAt:at(day,h2,m2).toISOString()});

test('2026 November weekdays count to 21, daily 600/hour 75',()=>{
  assert.equal(monthlyPlannedDays(2026,11,s),21);
  const q=getSnapshot(at(4,11),s);
  approx(q.dailyBase,600);approx(q.hourlyRate,75);approx(q.scheduledHours,8);
});
test('first app open Nov 4 11:00 backfills 2 earlier weekdays',()=>{
  const q=getSnapshot(at(4,11),s);
  approx(q.todayEarned,150);approx(q.monthlyEarned,1350);approx(q.progress,.25);
  assert.equal(q.displayedTodayEarned,'150.0000');assert.equal(q.displayedMonthlyEarned,'1350.00');
  assert.equal(q.status,'working');
});
test('pause 10:00 to 10:30 only removes effective time',()=>{
  const q=getSnapshot(at(4,11),s,{},[pause(4,10,0,10,30)]);
  approx(q.todayEarned,112.50);approx(q.monthlyEarned,1312.5);
});
test('pause overlaps lunch: 11:50 to 13:20 removes 30 work minutes',()=>{
  const q=getSnapshot(at(4,14),s,{},[pause(4,11,50,13,20)]);
  approx(q.todayWorkedHours,3.5);approx(q.todayEarned,262.5);
});
test('overlapping pause records merged, never double deduct',()=>{
  const q=getSnapshot(at(4,11),s,{},[pause(4,10,0,10,30),pause(4,10,15,10,45)]);
  approx(q.todayWorkedHours,1.25);approx(q.todayEarned,93.75);
});
test('active pause persists but applies only same work_date',()=>{
  const open={dateKey:'2026-11-04',startedAt:at(4,16).toISOString(),endedAt:null};
  assert.equal(statusAt(at(4,17),s,{},[open]),'paused');
  const q=getSnapshot(at(5,10),s,{},[open]);
  approx(q.todayEarned,75);
  assert.equal(q.status,'working');
  // Previous 11/4 counted 6.0h, not 8.0h
  approx(q.monthlyEarned,600+600+450+75);
});
test('commission is independent of today income',()=>{
  const q=getSnapshot(at(4,11),s,{},[],[{dateKey:'2026-11-03',amountCny:200}]);
  approx(q.monthlyEarned,1550);approx(q.todayEarned,150);approx(q.monthlyCommissionEarned,200);
});
test('future commission is not credited before its date',()=>{
  const q=getSnapshot(at(4,11),s,{},[],[{dateKey:'2026-11-05',amountCny:200}]);
  approx(q.monthlyEarned,1350);
});
test('override previous Tuesday off adjusts denominator',()=>{
  const q=getSnapshot(at(4,11),s,{'2026-11-03':'off'});
  assert.equal(q.plannedDays,20);approx(q.dailyBase,630);approx(q.todayEarned,157.5);approx(q.monthlyEarned,787.5);
});
test('unpaid leave keeps denominator but zeroes that date',()=>{
  const q=getSnapshot(at(4,11),s,{'2026-11-03':'unpaid_leave'});
  assert.equal(q.plannedDays,21);approx(q.monthlyEarned,750);
});
test('Saturday 11/07 make-up work increases denominator',()=>{
  const q=getSnapshot(at(4,11),s,{'2026-11-07':'work'});
  assert.equal(q.plannedDays,22);approx(q.dailyBase,12600/22);
});
test('key status boundaries and money caps',()=>{
  assert.equal(getSnapshot(at(4,8,59),s).status,'pre_work');
  assert.equal(getSnapshot(at(4,9),s).status,'working');
  assert.equal(getSnapshot(at(4,12),s).status,'lunch');
  assert.equal(getSnapshot(at(4,13),s).status,'working');
  const q=getSnapshot(at(4,18),s);
  assert.equal(q.status,'off_work');approx(q.todayEarned,600);
  assert.equal(getSnapshot(at(7,12),s).status,'rest_day');
});
test('month rollover: first of December morning is not November balance',()=>{
  const q=getSnapshot(new Date(2026,11,1,8,0),s,{},[],[{dateKey:'2026-11-03',amountCny:200}]);
  approx(q.todayEarned,0);approx(q.monthlyEarned,0);
});
test('invalid configuration fails fast',()=>{
  assert.throws(()=>getSnapshot(at(4,11),{...s,salaryCny:0}));
  assert.throws(()=>getSnapshot(at(4,11),{...s,weekdays:[]}));
  assert.throws(()=>getSnapshot(at(4,11),{...s,lunchStart:'19:00'}));
  assert.throws(()=>getSnapshot(at(4,11),{...s,shiftEnd:'08:00'}));
  assert.equal(validateSettings(s),true);
});

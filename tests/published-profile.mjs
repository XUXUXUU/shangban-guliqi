import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const [path, action, value] = process.argv.slice(2);
assert.ok(process.env.GITHUB_ACTIONS === "true", "Disposable runner required");
const db = new DatabaseSync(path);
try {
  db.exec("PRAGMA busy_timeout=5000");
  const read = () => JSON.parse(db.prepare("SELECT payload FROM profile WHERE id=1").get().payload);
  if (action === "read") console.log(JSON.stringify(read()));
  else if (action === "fail-on") db.exec("CREATE TRIGGER qa_fail BEFORE UPDATE ON profile BEGIN SELECT RAISE(ABORT,'QA write failure'); END;");
  else if (action === "fail-off") db.exec("DROP TRIGGER IF EXISTS qa_fail");
  else if (action === "check") assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  else {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayKey = [now.getFullYear(), String(now.getMonth()+1).padStart(2,"0"),String(now.getDate()).padStart(2,"0")].join("-");
    const profile = {
      settings: { salaryCents: 50000, attendanceCents: 20000, payday:10, weekdays:[1,2,3,4,5,6,7],
        shiftStart:"09:00",shiftEnd:"18:00",lunchStart:"12:00",lunchEnd:"13:00" },
      onboardingCompleted:true,pinned:false,theme:"light",overrides:{},
      commissions:[{id:"old-entry",dateKey:dayKey,amountCents:12345}],pauses:[],
      attendanceMonths:{},customGoals:[],builtInGoalOverrides:{},
    };
    if (action === "amount") {
      const amount = Number(value), ms = Math.round(amount*10000);
      assert.ok(ms < now-midnight, "Fixture needs a local time after 02:47");
      const days = new Date(now.getFullYear(),now.getMonth()+1,0).getDate();
      profile.settings={...profile.settings, salaryCents: days*862800, attendanceCents:0,
        shiftStart:"00:00",shiftEnd:"23:59",lunchStart:"23:57",lunchEnd:"23:58"};
      profile.pauses=[{dateKey:dayKey,startedAt:midnight.getTime()+ms,endedAt:null}];
    } else if (action === "upgrade") {
      profile.customGoals=[{id:"custom:legacy",name:"QA Custom",priceCents:8001}];
      profile.builtInGoalOverrides={"builtin:breakfast":{name:"QA Legacy Goal",priceCents:3025}};
      profile.hiddenBuiltInGoalIds=["builtin:asahi_beer"];
    } else assert.equal(action, "base");
    db.prepare("INSERT INTO profile(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").run(JSON.stringify(profile));
  }
} finally { db.close(); }

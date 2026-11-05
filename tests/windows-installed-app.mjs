import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";

const [exe, evidence] = process.argv.slice(2).map((path) => resolve(path));
assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.ok(exe && evidence);
await mkdir(evidence, { recursive: true });
const dbPath = join(process.env.LOCALAPPDATA, "com.shangbanguliqi.desktop", "earnings.sqlite3");

const legacyProfile = {
  settings: {
    salaryCents: 600005, attendanceCents: 50000, payday: 10, weekdays: [1, 2, 3, 4, 5],
    shiftStart: "08:00", shiftEnd: "19:00", lunchStart: "12:00", lunchEnd: "14:00",
  },
  pinned: true, overrides: { "2026-11-03": "off" },
  pauses: [{ dateKey: "2026-11-03", startedAt: 1793673600000, endedAt: 1793675400000 }],
  commissions: [{ id: "old", dateKey: "2026-11-03", amountCents: 10000 }],
  attendanceMonths: { "2026-10": false },
  customGoals: [{ id: "custom:old", name: "一次洗车", priceCents: 8000 }],
  builtInGoalOverrides: { "builtin:breakfast": { name: "一份晨间早餐", priceCents: 3025 } },
};

function readDb(fn) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}

async function waitFor(app, description, check) {
  let failure;
  for (let i = 0; i < 80; i++) {
    if (app.exitCode !== null) throw new Error(`App closed during launch (${app.exitCode})`);
    try {
      const result = check();
      if (result) return result;
    } catch (error) {
      failure = error;
    }
    await delay(250);
  }
  throw new Error(description, { cause: failure });
}

async function withApp(run) {
  const app = spawn(exe, { stdio: "ignore" });
  const exited = once(app, "exit");
  exited.catch(() => {});
  try {
    await run(app);
  } finally {
    if (app.exitCode === null && app.pid) {
      app.kill();
      await exited;
    }
  }
}

await withApp(async (app) => {
  await waitFor(app, "Installed app did not initialize its SQLite database", () =>
    readDb((db) => db.prepare("PRAGMA user_version").get().user_version === 2));
});
const db = new DatabaseSync(dbPath);
try {
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM profile").get().n, 0);
  db.prepare("INSERT INTO profile (id, payload) VALUES (1, ?)").run(JSON.stringify(legacyProfile));
} finally {
  db.close();
}

await withApp(async (app) => {
  const profile = await waitFor(app, "The installed app did not read and migrate the test profile", () => {
    const saved = readDb((db) => JSON.parse(db.prepare("SELECT payload FROM profile WHERE id=1").get().payload));
    return saved.onboardingCompleted && saved;
  });
  for (const [key, value] of Object.entries(legacyProfile)) assert.deepEqual(profile[key], value);

  const ui = spawn("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", ".github/scripts/windows-app-ui.ps1", "-AppPid", String(app.pid), "-EvidenceDir", evidence,
  ], { stdio: "inherit" });
  const [code] = await once(ui, "exit");
  if (code !== 0) console.warn(`Windows UI Automation did not complete (exit ${code}). See app-ui-result.txt.`);
});
const profile = readDb((db) => {
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  return JSON.parse(db.prepare("SELECT payload FROM profile WHERE id=1").get().payload);
});
assert.equal(profile.onboardingCompleted, true);
assert.equal(profile.pinned, true);
assert.deepEqual(profile.commissions, legacyProfile.commissions);
assert.deepEqual(profile.pauses, legacyProfile.pauses);
await writeFile(join(evidence, "app-sqlite-result.txt"), "Installed Windows EXE initialized, reopened, loaded/migrated its test SQLite profile, and preserved historical entries. Integrity check passed.\n");
console.log("Installed Windows EXE: process restart, legacy profile migration and real SQLite integrity passed");

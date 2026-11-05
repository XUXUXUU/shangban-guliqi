
import assert from "node:assert/strict";
import { chromium, webkit } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}/`;
  browser = await (process.env.SHANGBAN_BROWSER === "webkit" ? webkit : chromium).launch({ executablePath: process.env.SHANGBAN_CHROME });
  const page = await browser.newPage({
    viewport: { width: 400, height: 550 },
    timezoneId: "Asia/Shanghai",
    userAgent: process.env.RUNNER_OS === "Windows"
      ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
      : undefined,
  });
  await page.clock.setFixedTime(new Date("2026-11-04T11:00:00+08:00"));
  const fixture = {
    settings: { salaryCents: 500000, attendanceCents: 20000, payday: 10, weekdays: [1,2,3,4,5],
      shiftStart: "09:00", shiftEnd: "18:00", lunchStart: "12:00", lunchEnd: "13:00" },
    onboardingCompleted: true, pinned: true, overrides: { "2026-11-03": "off" }, theme: "light",
    pauses: [{ dateKey: "2026-11-03", startedAt: 1793673600000, endedAt: 1793675400000 }],
    commissions: [{ id: "old", dateKey: "2026-11-03", amountCents: 10000 }],
    customGoals: [], attendanceMonths: { "2026-10": false },
  };
  await page.addInitScript((initial) => {
    if (!localStorage.profile) localStorage.profile = JSON.stringify(initial);
    let pinned = false;
    let autostart = false;
    window.saveCalls = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd === "load_profile") return JSON.parse(localStorage.profile);
        if (cmd === "save_profile") {
          window.saveCalls++;
          if (window.pauseWrite) await new Promise(resolve => { window.resumeWrite = resolve; });
          if (window.failWrite) throw new Error("测试：无法核实保存");
          localStorage.profile = JSON.stringify(args.profile);
          return JSON.parse(localStorage.profile);
        }
        if (cmd.endsWith("|set_always_on_top")) pinned = args.value;
        if (cmd.endsWith("|is_always_on_top")) return pinned;
        if (cmd.endsWith("|enable")) autostart = true;
        if (cmd.endsWith("|disable")) autostart = false;
        if (cmd.endsWith("|is_enabled")) return autostart;
        return false;
      },
    };
  }, fixture);
  const button = name => page.getByRole("button", { name, exact: true });
  const field = name => page.getByRole("textbox", { name, exact: true });
  const visible = locator => locator.waitFor({ state: "visible", timeout: 7000 });
  const home = () => visible(page.getByRole("heading", { name: "上班中" }));
  const persisted = () => page.evaluate(() => JSON.parse(localStorage.profile));
  const settings = async () => {
    await button("设置").click();
    await visible(page.getByRole("heading", { name: "设置", exact: true }));
    await visible(page.getByRole("button", { name: /工资与发薪/ }));
  };
  const panel = async (label) => {
    await page.getByRole("button", { name: new RegExp(label) }).click();
    await visible(page.getByRole("heading", { name: label, exact: true }));
  };
  const savePanel = async () => {
    await button("保存修改").click();
    await visible(page.getByRole("heading", { name: "设置", exact: true }));
  };
  const closeSettings = async () => {
    await button("返回").click();
    await home();
  };
  const time = async (label, from, to) => {
    await button(label + " " + from).click();
    const dialog = page.getByRole("dialog", { name: label, exact: true });
    await visible(dialog);
    const [hour, minute] = to.split(":").map(Number);
    await dialog.evaluate((el, [h, m]) => {
      const [hours, minutes] = el.querySelectorAll('[role="spinbutton"]');
      hours.scrollTo({ top: h * 42, behavior: "instant" });
      minutes.scrollTo({ top: m * 42, behavior: "instant" });
      [...el.querySelectorAll("button")].find(btn => btn.textContent.trim() === "确认").click();
    }, [hour, minute]);
    await visible(button(label + " " + to));
  };
  const verifyLiveAmount = async () => page.evaluate(() => {
    const box = document.querySelector(".amount");
    const whole = box?.querySelector(".amount-value .amount-whole");
    const decimal = box?.querySelector(".amount-value .amount-decimal");
    const frac = box?.querySelector(".amount-value .amount-fraction");
    if (!box || !whole || !decimal || !frac) throw new Error("Segmented live amount missing");
    const a=whole.getBoundingClientRect(), b=decimal.getBoundingClientRect(), c=frac.getBoundingClientRect();
    const outer=box.getBoundingClientRect();
    if (b.left < a.right-0.5 || c.left < b.right-0.5) throw new Error("Amount decimal glyphs overlap");
    if (a.left < outer.left-0.5 || c.right > outer.right+0.5) throw new Error("Amount exceeds viewport");
    return true;
  });

  await page.goto(url);
  await home();
  for (const width of [400, 448, 560]) {
    await page.setViewportSize({ width, height: 650 });
    assert.equal(await verifyLiveAmount(), true);
  }
  await page.setViewportSize({ width: 400, height: 550 });

  // Tier-one hub has groups, icon SVGs, and no cluttered inline controls.
  await settings();
  for (const title of ["收入与工作", "个性化", "数据"]) {
    await visible(page.getByRole("heading", { name: title, exact: true }));
  }
  assert.equal(await page.locator(".settings-menu-row").count(), 5);
  assert.equal(await page.locator(".settings-menu-row .settings-menu-icon svg").count(), 5);
  assert.equal(await field("税后月薪（元）").count(), 0);
  assert.equal(await button("保存修改").count(), 0);
  assert.equal(await button("取消置顶").getAttribute("aria-pressed"), "true");

  // Schedule editor is independent of income; values persist across close/reopen.
  await panel("作息安排");
  await time("上班","09:00","08:30");
  await time("下班","18:00","19:00");
  assert.equal(await page.getByRole("checkbox", { name: "窗口置顶" }).count(), 0);
  await savePanel();
  assert.equal((await persisted()).settings.shiftStart,"08:30");
  assert.equal((await persisted()).settings.shiftEnd,"19:00");
  await panel("作息安排");
  await visible(button("上班 08:30"));
  await visible(button("下班 19:00"));
  await time("上班","08:30","08:00");
  await time("下班","19:00","18:00");
  await time("午休结束","13:00","14:00");
  assert.equal(await page.locator(".derived output").innerText(),"8 小时");
  await savePanel();
  await panel("作息安排");
  await time("下班","18:00","19:00");
  assert.equal(await page.locator(".derived output").innerText(),"9 小时");
  await savePanel();
  await closeSettings();
  await page.reload();
  await home();
  await settings();
  await panel("作息安排");
  assert.equal(await page.locator(".derived output").innerText(),"9 小时");
  await button("返回").click(); // Back to hub, not home

  // Salary/bonus must save through Rust-validated profile and not be overwritten by old draft.
  await panel("工资与发薪");
  const salary = field("税后月薪（元）");
  const bonus = field("满勤奖金（元）");
const rateBefore = await page.locator(".settings-income-preview strong").innerText();
  await salary.fill("6000.");
  assert.equal(await salary.inputValue(),"6000.");
  await salary.press("0");
  await salary.press("5");
  assert.equal(await salary.inputValue(),"6000.05");
  await salary.fill("6000");
  const rateAfter = await page.locator(".settings-income-preview strong").innerText();
  assert.notEqual(rateAfter,rateBefore);
  await bonus.fill("500");
  const before = await persisted();
  await page.evaluate(()=>{ window.failWrite=true;window.pauseWrite=true;window.saveCalls=0; });
  await button("保存修改").click();
  await page.waitForFunction(()=>typeof window.resumeWrite === "function");
  assert.equal(await salary.isDisabled(),true);
  await page.evaluate(()=>{ window.pauseWrite=false;window.resumeWrite(); });
  await visible(page.getByRole("alert").filter({ hasText: "无法核实保存" }));
  assert.deepEqual(await persisted(),before);
  assert.equal(await salary.inputValue(),"6000");
  await page.evaluate(()=>{ window.failWrite=false;window.saveCalls=0; });
  await savePanel();
  assert.equal(await page.evaluate(()=>window.saveCalls),1);
  assert.equal((await persisted()).settings.salaryCents,600000);
  assert.equal((await persisted()).settings.attendanceCents,50000);
  assert.deepEqual((await persisted()).pauses,fixture.pauses);
  assert.deepEqual((await persisted()).commissions,fixture.commissions);
  await panel("工资与发薪");
  assert.equal(await field("税后月薪（元）").inputValue(),"6000");
  assert.equal(await field("满勤奖金（元）").inputValue(),"500");
  await field("税后月薪（元）").fill("7000");
  await button("取消").click();
  await panel("工资与发薪");
  assert.equal(await field("税后月薪（元）").inputValue(),"6000","Canceled draft must not persist");
  await button("返回").click();

  // Startup is a secondary page, native-like switch toggles and persists.
  await panel("启动与驻留");
  const switcher = page.getByRole("switch",{name:"开机启动"});
  await visible(switcher);
  assert.equal(await switcher.getAttribute("aria-checked"),"false");
  await switcher.click();
  await page.waitForFunction(()=>document.querySelector('[role="switch"]')?.getAttribute("aria-checked")==="true");
  await button("返回").click();

  // Re-enter onboarding is under data/tools only.
  await panel("数据与工具");
  await visible(button("重新查看新手引导"));
  await visible(button("清空本地数据"));
  await button("返回").click();

  // Goal editing, vector remove, and hide/restore (no data loss).
  await page.getByRole("button",{name:/激励目标/}).click();
  const list = page.getByRole("region",{name:"内置目标"}).getByRole("listitem");
  assert.equal(await list.count(),30);
  assert.equal(await list.locator("button.goal-remove").count(),30);
  const first=list.first();
  const defaultName=await first.locator(".goal-name strong").innerText();
  await first.getByRole("button",{name:/^编辑 /}).click();
  await visible(page.getByRole("dialog",{name:"编辑目标"}));
  await field("目标名称").fill("我的新目标");
  await field("价格（元）").fill("30.25");
  await button("保存").click();
  await visible(first.getByText("我的新目标"));
  assert.equal((await persisted()).builtInGoalOverrides["builtin:tsingtao_green_bottle"].priceCents,3025);
  await first.getByRole("button",{name:"移除 我的新目标"}).click();
  await visible(page.getByRole("dialog",{name:"移除目标"}));
  await button("确认移除").click();
  assert.equal(await list.count(),29);
  assert.deepEqual((await persisted()).hiddenBuiltInGoalIds,["builtin:tsingtao_green_bottle"]);
  await page.getByText("已移除目标（1）").click();
  await button("恢复").click();
  assert.equal(await list.count(),30);
  assert.deepEqual((await persisted()).hiddenBuiltInGoalIds,[]);
  assert.equal((await persisted()).builtInGoalOverrides["builtin:tsingtao_green_bottle"].name,"我的新目标");

  await first.getByRole("button",{name:/^编辑 /}).click();
  await button("恢复默认").click();
  await visible(first.getByText(defaultName));
  assert.deepEqual((await persisted()).builtInGoalOverrides,{});
  await page.reload();
  await home();
  await settings();
  await page.getByRole("button",{name:/激励目标/}).click();
  assert.equal(await list.count(),30);
  await button("返回").click(); // Goals -> settings hub
  await closeSettings();

  console.log("PASS: amount boundaries, five icon settings rows, two secondary editors with persistence, startup switch, data/tools, thirty defaults, remove/restore.");
} finally {
  await browser?.close();
  await server.close();
}

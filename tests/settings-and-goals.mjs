import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";

const host = "127.0.0.1";
const server = await createServer({ server: { host, port: 0, strictPort: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert.ok(address && typeof address === "object");
  const url = `http://${host}:${address.port}/`;
  browser = await chromium.launch({ executablePath: process.env.SHANGBAN_CHROME });
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
    window.saveCalls = 0;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" } },
      transformCallback: () => 1,
      invoke: async (cmd, args) => {
        if (cmd === "load_profile") return JSON.parse(localStorage.profile);
        if (cmd === "save_profile") {
          window.saveCalls++;
          if (window.pauseWrite) await new Promise((resolve) => { window.resumeWrite = resolve; });
          if (window.failWrite) throw new Error("测试：无法核实保存");
          localStorage.profile = JSON.stringify(args.profile);
          return JSON.parse(localStorage.profile);
        }
        if (cmd.endsWith("|set_always_on_top")) pinned = args.value;
        if (cmd.endsWith("|is_always_on_top")) return pinned;
        return false;
      },
    };
  }, fixture);
  const button = (name) => page.getByRole("button", { name, exact: true });
  const field = (name) => page.getByRole("textbox", { name, exact: true });
  const visible = (locator) => locator.waitFor({ state: "visible", timeout: 4000 });
  const home = () => visible(page.getByRole("heading", { name: "上班中" }));
  const settings = async () => {
    await button("设置").click();
    await visible(button("保存设置"));
  };
  const persisted = () => page.evaluate(() => JSON.parse(localStorage.profile));
  const submit = async () => { await button("保存设置").click(); await home(); };
  const time = async (label, from, to) => {
    await button(label + " " + from).click();
    const dialog = page.getByRole("dialog", { name: label, exact: true });
    const [hour, minute] = to.split(":").map(Number);
    // Simulate a confirmation before the final scroll events have been delivered.
    await dialog.evaluate((el, [h, m]) => {
      const [hours, minutes] = el.querySelectorAll('[role="spinbutton"]');
      hours.scrollTo({ top: h * 42, behavior: "instant" });
      minutes.scrollTo({ top: m * 42, behavior: "instant" });
      [...el.querySelectorAll("button")].find((btn) => btn.textContent.trim() === "确认").click();
    }, [hour, minute]);
    await visible(button(label + " " + to));
  };

  await page.goto(url);
  await home();
  // Regression for macOS decimal-first-digit clipping: decimal and fraction must not overlap,
  // and each glyph must remain within the live amount box at compact/normal widths.
  const verifyLiveAmount = async () => page.evaluate(() => {
    const box = document.querySelector(".amount");
    const whole = box?.querySelector(".amount-value .amount-whole");
    const decimal = box?.querySelector(".amount-value .amount-decimal");
    const frac = box?.querySelector(".amount-value .amount-fraction");
    if (!box || !whole || !decimal || !frac) throw new Error("Live amount segmented DOM is missing");
    const a = whole.getBoundingClientRect(), b = decimal.getBoundingClientRect();
    const c = frac.getBoundingClientRect(), outer = box.getBoundingClientRect();
    if (b.left < a.right - 0.5 || c.left < b.right - 0.5) throw new Error("Decimal glyph overlap");
    if (a.left < outer.left || c.right > outer.right + 0.5) throw new Error("Live amount horizontal clipping");
    return true;
  });
  assert.equal(await verifyLiveAmount(), true);
  for (const w of [400, 448, 560]) {
    await page.setViewportSize({ width: w, height: 650 });
    assert.equal(await verifyLiveAmount(), true);
  }
  await page.setViewportSize({ width: 400, height: 550 });
  await settings();
  assert.equal(await button("取消置顶").getAttribute("aria-pressed"), "true");
  await time("上班", "09:00", "08:30");
  await time("下班", "18:00", "19:00");
  assert.equal(await page.getByRole("checkbox", { name: "窗口置顶" }).count(), 0, "Duplicate pin setting");
  await submit();
  assert.equal((await persisted()).settings.shiftStart, "08:30");
  assert.equal((await persisted()).settings.shiftEnd, "19:00");
  await page.reload();
  await home();
  await settings();
  await visible(button("上班 08:30"));
  await visible(button("下班 19:00"));
  await time("上班", "08:30", "08:00");
  await time("下班", "19:00", "18:00");
  await time("午休结束", "13:00", "14:00");
  assert.equal(await page.locator(".derived output").innerText(), "8 小时");
  await submit();
  await settings();
  await time("下班", "18:00", "19:00");
  assert.equal(await page.locator(".derived output").innerText(), "9 小时");
  await submit();
  await page.reload();
  await home();
  await settings();
  assert.equal(await page.locator(".derived output").innerText(), "9 小时");

  const salary = field("税后月薪（元）");
  const bonus = field("满勤奖金（元）");
  const original = await persisted();
  const preview = () => page.locator(".preview dd").allTextContents();
  const [rateBefore, todayBefore, monthBefore] = await preview();
  await salary.fill("6000.");
  assert.equal(await salary.inputValue(), "6000.");
  await salary.press("0");
  await salary.press("5");
  assert.equal(await salary.inputValue(), "6000.05");
  await salary.fill("6000");
  const [rateAfter, todayAfter, monthAfter] = await preview();
  assert.notEqual(rateAfter, rateBefore);
  assert.notEqual(todayAfter, todayBefore);
  assert.notEqual(monthAfter, monthBefore);
  const money = (value) => Number(value.replace(/[^\d.]/g, ""));
  await bonus.fill("500");
  const [, , monthWithBonus] = await preview();
  assert.equal(Math.round((money(monthWithBonus) - money(monthAfter)) * 100), 30000);

  await page.evaluate(() => { window.failWrite = true; window.pauseWrite = true; window.saveCalls = 0; });
  await button("保存设置").click();
  await page.waitForFunction(() => typeof window.resumeWrite === "function");
  assert.equal(await salary.isDisabled(), true);
  assert.equal(await button("上班 08:00").isDisabled(), true);
  await page.evaluate(() => { window.pauseWrite = false; window.resumeWrite(); });
  await visible(page.getByRole("alert").filter({ hasText: "无法核实保存" }));
  assert.deepEqual(await persisted(), original);
  assert.equal(await salary.inputValue(), "6000");
  assert.equal(await bonus.inputValue(), "500");
  await page.evaluate(() => { window.failWrite = false; window.saveCalls = 0; });
  await submit();
  assert.equal(await page.evaluate(() => window.saveCalls), 1);
  const saved = await persisted();
  assert.equal(saved.settings.salaryCents, 600000);
  assert.equal(saved.settings.attendanceCents, 50000);
  assert.deepEqual(saved.pauses, fixture.pauses);
  assert.deepEqual(saved.commissions, fixture.commissions);
  assert.deepEqual(saved.overrides, fixture.overrides);
  assert.equal(saved.pinned, true);
  assert.equal(await page.locator(".monthly").innerText().then((v) => v.trim()), monthWithBonus);
  assert.equal(await page.locator(".hourly strong").innerText().then(money), Number((money(rateAfter) / 3600).toFixed(4)));
  assert.equal(Math.round((await page.locator(".amount-value").innerText().then(money)) * 100), Math.round(money(todayAfter) * 100));
  await button("满勤奖：已满勤").click();
  await visible(button("满勤奖：无满勤"));
  assert.equal(Math.round((money(monthWithBonus) - money(await page.locator(".monthly").innerText())) * 100), 50000);
  await page.reload();
  await home();
  await visible(button("满勤奖：无满勤"));
  await settings();
  assert.equal(await salary.inputValue(), "6000");
  assert.equal(await bonus.inputValue(), "500");
  const beforeCancel = await persisted();
  await salary.fill("7000");
  await bonus.fill("900");
  await time("午休开始", "12:00", "11:30");
  await button("取消").click();
  await home();
  assert.deepEqual(await persisted(), beforeCancel);

  await settings();
  const manage = () => page.getByRole("button", { name: /激励目标.*管理/ }).click();
  await manage();
  const entries = page.getByRole("region", { name: "内置目标" }).getByRole("listitem");
  assert.equal(await entries.count(), 30);
  assert.equal(await entries.locator("button.goal-remove").count(), 30, "Every built-in goal has a vector remove control");
  for (const entry of await entries.all()) {
    await entry.getByRole("button", { name: /^编辑 / }).click();
    await visible(page.getByRole("dialog", { name: "编辑目标" }));
    await button("取消").click();
  }
  const first = entries.first();
  await first.getByRole("button", { name: /^编辑 / }).click();
  await field("目标名称").fill("一份晨间早餐");
  await field("价格（元）").fill("0.001");
  await button("保存").click();
  await visible(page.getByRole("alert"));
  await field("价格（元）").fill("30.25");
  await button("保存").click();
  await visible(first.getByText("一份晨间早餐"));
  await visible(first.getByText("¥30.25"));
  await button("返回").click();
  await button("返回").click();
  await home();
  assert.match(await page.locator(".motivation").innerText(), /一份晨间早餐/);
  await page.reload();
  await home();
  assert.match(await page.locator(".motivation").innerText(), /一份晨间早餐/);
  await settings();
  await manage();
  await first.getByRole("button", { name: /^编辑 / }).click();
  await field("目标名称").fill("不应该保存");
  await button("取消").click();
  await visible(first.getByText("一份晨间早餐"));
  await first.getByRole("button", { name: /^编辑 / }).click();
  await button("恢复默认").click();
  await visible(first.getByText("一根下班路上的烤肠").or(first.getByText("一瓶青岛绿瓶啤酒")));
  assert.deepEqual((await persisted()).builtInGoalOverrides, {});
  await button("返回").click();
  await button("返回").click();
  await home();
  await button("取消置顶").click();
  await visible(button("置顶窗口"));
  assert.equal((await persisted()).pinned, false);
  await button("置顶窗口").click();
  await visible(button("取消置顶"));
  await page.reload();
  await home();
  await visible(button("取消置顶"));
  // Built-in goals use a separate vector × button, hide persistently and restore without data loss.
  await manage();
  const firstBeforeRemove = entries.first();
  const firstLabel = await firstBeforeRemove.locator(".goal-name strong").innerText();
  await firstBeforeRemove.getByRole("button", { name: `移除 ${firstLabel}` }).click();
  await visible(page.getByRole("dialog", { name: "移除目标" }));
  await button("确认移除").click();
  assert.equal((await persisted()).hiddenBuiltInGoalIds.length, 1);
  assert.equal(await entries.count(), 29);
  const removed = page.getByText("已移除目标（1）");
  await removed.click();
  await page.getByRole("button", { name: "恢复", exact: true }).click();
  assert.equal((await persisted()).hiddenBuiltInGoalIds.length, 0);
  assert.equal(await entries.count(), 30);
  console.log("Settings, income/attendance, restart, 30 editable defaults, vector remove and restore: PASS");
} finally {
  await browser?.close();
  await server.close();
}

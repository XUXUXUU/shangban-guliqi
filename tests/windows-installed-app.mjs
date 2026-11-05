import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const [exe, evidence] = process.argv.slice(2).map((path) => resolve(path));
assert.equal(process.platform, "win32");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.ok(exe && evidence);
await mkdir(evidence, { recursive: true });

async function withApp(port, run) {
  const app = spawn(exe, {
    stdio: "ignore",
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --remote-debugging-address=127.0.0.1`,
      WEBVIEW2_USER_DATA_FOLDER: join(process.env.RUNNER_TEMP, `shangban-webview-${port}`),
    },
  });
  const exited = once(app, "exit");
  exited.catch(() => {});
  const endpoint = `http://127.0.0.1:${port}`;
  let browser;
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (app.exitCode !== null) throw new Error(`App closed during launch (${app.exitCode})`);
      if (await fetch(endpoint + "/json/version", { signal: AbortSignal.timeout(1000) })
        .then((res) => res.ok).catch(() => false)) break;
      await delay(250);
    }
    browser = await chromium.connectOverCDP(endpoint, { timeout: 5000 });
    const context = browser.contexts()[0];
    const page = context.pages()[0] ?? await context.waitForEvent("page", { timeout: 5000 });
    page.setDefaultTimeout(6000);
    await run(page);
  } finally {
    try {
      if (app.exitCode === null && app.pid) {
        app.kill();
        await exited;
      }
    } finally {
      await browser?.close().catch(() => {});
    }
  }
}

function controls(page) {
  const button = (name) => page.getByRole("button", { name, exact: true });
  const field = (name) => page.getByRole("textbox", { name, exact: true });
  const manage = () => page.getByRole("button", { name: /激励目标.*管理/ }).click();
  const first = page.getByRole("region", { name: "内置目标" }).getByRole("listitem").first();
  const wait = (locator) => locator.waitFor({ state: "visible" });
  const changeHour = async (name, oldTime, direction, newTime) => {
    await button(name + " " + oldTime).click();
    await page.getByRole("spinbutton", { name: "时", exact: true }).press(direction);
    await button("确认").click();
    await wait(button(name + " " + newTime));
  };
  return { button, field, manage, first, wait, changeHour };
}

await withApp(39271, async (page) => {
  const { button, field, manage, first, wait, changeHour } = controls(page);
  const salary = field("每月税后工资（元）");
  await wait(salary);
  assert.equal(await salary.inputValue(), "");
  await salary.fill("5000");
  await button("继续").click();
  await button("继续").click();
  await button("开始使用").click();
  await button("设置").click();
  assert.equal(await page.getByRole("checkbox", { name: "窗口置顶" }).count(), 0);
  await button("置顶窗口").click();
  await wait(button("取消置顶"));
  await changeHour("上班", "09:00", "ArrowUp", "08:00");
  await changeHour("下班", "18:00", "ArrowDown", "19:00");
  await changeHour("午休结束", "13:00", "ArrowDown", "14:00");
  await field("税后月薪（元）").fill("6000.05");
  await field("满勤奖金（元）").fill("500");
  assert.equal(await page.locator(".derived output").innerText(), "9 小时");
  await button("保存设置").click();
  await button("设置").click();
  await manage();
  await first.getByRole("button", { name: /^编辑 / }).click();
  await field("目标名称").fill("一份晨间早餐");
  await field("价格（元）").fill("30.25");
  await button("保存").click();
  await wait(first.getByText("¥30.25"));
});

await withApp(39272, async (page) => {
  const { button, field, manage, first, wait } = controls(page);
  await wait(button("取消置顶"));
  await button("设置").click();
  for (const name of ["上班 08:00", "下班 19:00", "午休结束 14:00"]) await wait(button(name));
  assert.equal(await field("税后月薪（元）").inputValue(), "6000.05");
  assert.equal(await field("满勤奖金（元）").inputValue(), "500");
  await field("税后月薪（元）").scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, "05-app-settings-after-restart.png") });
  await manage();
  await wait(first.getByText("一份晨间早餐"));
  await wait(first.getByText("¥30.25"));
  await first.getByRole("button", { name: /^编辑 / }).click();
  await page.screenshot({ path: join(evidence, "06-app-edited-built-in-goal.png") });
  await button("恢复默认").click();
  await wait(first.getByText("¥18.00"));
});
console.log("Installed Windows EXE: real WebView2, settings, pin, goals and SQLite survived process restart");

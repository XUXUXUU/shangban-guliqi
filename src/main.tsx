import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { at, dayKey } from "./domain/earnings";
import {
  addCommission,
  daysToPayday,
  daysToSaturday,
  empty,
  needsOnboarding,
  profileSnapshot,
  rules,
  toggleAttendance,
} from "./domain/profile";
import type { Profile } from "./domain/profile";
import { advanceGoal, goalPool, motivation } from "./domain/motivation";
import type { GoalProgress } from "./domain/motivation";
import { Goals } from "./ui/Goals";
import { Settings } from "./ui/Settings";
import {
  WindowControls,
  WindowsTitleBar,
  windowsShell,
} from "./ui/WindowControls";
import { LiveAmount } from "./ui/LiveAmount";
import { Wizard } from "./ui/Wizard";
import { CommissionForm } from "./ui/CommissionForm";
import { clockDuration, money, msg } from "./ui/format";
import "./style.css";

const labels = {
  working: "上班中",
  paused: "暂停中",
  pre_work: "还没上班",
  lunch: "午休中",
  off_work: "已下班",
  rest_day: "休息日",
};
const weekdayLabel = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });
const localClock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function App() {
  const [p, setP] = useState<Profile | null>(null);
  useEffect(() => {
    document.documentElement.dataset.theme = p?.theme ?? "light";
  }, [p?.theme]);
  const [page, setPage] = useState<
    "home" | "settings" | "history" | "wizard" | "goals"
  >("home");
  const [now, setNow] = useState(() => new Date());
  const [goalProgress, setGoalProgress] = useState<GoalProgress | null>(null);
  const goals = useMemo(() => goalPool(p?.customGoals ?? []), [p?.customGoals]);
  const [adding, setAdding] = useState(false);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const lock = useRef(false);
  const content = useRef<HTMLElement>(null);
  useEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [page]);
  const [error, setError] = useState("");
  useEffect(() => {
    void invoke<Profile | null>("load_profile")
      .then(async (saved) => {
        const profile = saved ?? empty();
        const window = getCurrentWindow();
        try {
          if (profile.pinned) {
            await window.setAlwaysOnTop(true);
            const applied = await window.isAlwaysOnTop();
            setIsPinned(applied);
            if (!applied) throw new Error("系统未恢复置顶设置。");
          }
        } catch (error) {
          setError(msg(error));
        } finally {
          setP(profile);
        }
      })
      .catch((e) => setError(msg(e)));
    const refresh = () => setNow(new Date());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const open = () => {
      setPage("settings");
      void isEnabled()
        .then(setAuto)
        .catch((e) => setError(msg(e)));
    };
    const listener = listen("open-settings", open).catch(() => () => {});
    const shortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => {
      void listener.then((f) => f());
      window.removeEventListener("keydown", shortcut);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    if (!p?.settings || page === "history" || page === "goals") return;
    const timer = setInterval(
      () => {
        if (!document.hidden) setNow(new Date());
      },
      page === "home" ? 100 : 1000,
    );
    return () => clearInterval(timer);
  }, [p?.settings, page]);
  async function run(fn: () => Promise<void>) {
    if (lock.current) throw new Error("正在保存，请稍候。");
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function store(next: Profile) {
    await invoke("save_profile", { profile: next });
    setP(next);
    setNow(new Date());
  }
  const action = (fn: () => Promise<void>) => {
    void run(fn).catch((e) => setError(msg(e)));
  };
  const onboarding = !p || needsOnboarding(p);
  const q =
    p && page === "home" && !onboarding ? profileSnapshot(p, now) : null;
  const activeGoal = q ? advanceGoal(goalProgress, q, goals) : goalProgress;
  useEffect(() => {
    if (activeGoal !== goalProgress) setGoalProgress(activeGoal);
  }, [activeGoal, goalProgress]);
  if (!p) return <main>{error || "正在读取本地数据…"}</main>;
  const s = p.settings ? rules(p.settings) : null;
  const today = dayKey(now);
  const openPause = p.pauses.find(
    (x) => x.dateKey === today && x.endedAt === null,
  );
  const status = q?.status;
  const clock =
    status && q && s
      ? {
          working: () => (
            <>
              距离下班还有{" "}
              <strong>
                {clockDuration(at(now, s.shiftEnd) - now.getTime())}
              </strong>
            </>
          ),
          pre_work: () =>
            "距离上班还有 " +
            clockDuration(at(now, s.shiftStart) - now.getTime()),
          lunch: () =>
            "午休结束还有 " +
            clockDuration(at(now, s.lunchEnd) - now.getTime()),
          paused: () =>
            "已暂停 " +
            clockDuration(
              now.getTime() - new Date(openPause?.startedAt ?? now).getTime(),
              true,
            ),
          off_work: () => "今日完成 " + q.todayWorkedHours.toFixed(1) + " 小时",
          rest_day: () => "今天不用上班",
        }[status]()
      : "";
  const settings = () => {
    setPage("settings");
    void isEnabled()
      .then(setAuto)
      .catch((e) => setError(msg(e)));
  };
  const togglePin = () =>
    action(async () => {
      const window = getCurrentWindow();
      const pinned = !isPinned;
      try {
        await window.setAlwaysOnTop(pinned);
        if ((await window.isAlwaysOnTop()) !== pinned)
          throw new Error("系统未应用置顶设置。");
        await store({ ...p, pinned });
        setIsPinned(pinned);
      } catch (error) {
        try {
          await window.setAlwaysOnTop(isPinned);
        } finally {
          setIsPinned(await window.isAlwaysOnTop().catch(() => isPinned));
        }
        throw error;
      }
    });
  const controls = (
    <WindowControls
      pinned={isPinned}
      dark={p.theme === "dark"}
      busy={busy}
      togglePin={togglePin}
      toggleTheme={() =>
        action(() =>
          store({ ...p, theme: p.theme === "dark" ? "light" : "dark" }),
        )
      }
      report={(error) => setError(msg(error))}
    />
  );
  return (
    <>
      {windowsShell && (
        <WindowsTitleBar report={(error) => setError(msg(error))}>
          {controls}
        </WindowsTitleBar>
      )}
      {!windowsShell && (!q || page !== "home") && (
        <div className="mac-window-controls">{controls}</div>
      )}
      <main ref={content}>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {onboarding || page === "wizard" || !p.settings ? (
          <Wizard
            profile={p}
            busy={busy}
            cancel={onboarding ? undefined : () => setPage("settings")}
            save={(next) =>
              run(async () => {
                await store(next);
                setPage("home");
              })
            }
          />
        ) : page === "settings" || page === "goals" ? (
          <>
            <div hidden={page !== "settings"}>
              <Settings
                profile={p}
                initial={p.settings}
                now={now}
                busy={busy}
                reviewOnboarding={() => setPage("wizard")}
                manageGoals={() => setPage("goals")}
                close={() => {
                  setNow(new Date());
                  setPage("home");
                }}
                save={(settings) =>
                  run(async () => {
                    await store({ ...p, settings });
                    setPage("home");
                  })
                }
              />
            </div>
            {page === "goals" ? (
              <Goals
                custom={p.customGoals ?? []}
                close={() => setPage("settings")}
                save={(goal) =>
                  run(async () => {
                    const custom = p.customGoals ?? [];
                    const exists = custom.some((g) => g.id === goal.id);
                    await store({
                      ...p,
                      customGoals: exists
                        ? custom.map((g) => (g.id === goal.id ? goal : g))
                        : [goal, ...custom],
                    });
                    if (!exists) setGoalProgress(null);
                  })
                }
                remove={(id) =>
                  run(() =>
                    store({
                      ...p,
                      customGoals: (p.customGoals ?? []).filter(
                        (g) => g.id !== id,
                      ),
                    }),
                  )
                }
              />
            ) : (
              <>
                <section className="card">
                  <h2>窗口与开机启动</h2>
                  <label className="row">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={isPinned}
                      onChange={togglePin}
                    />
                    窗口置顶
                  </label>
                  <label className="row">
                    <input
                      type="checkbox"
                      disabled={busy || auto === null}
                      checked={auto ?? false}
                      onChange={(e) => {
                        const value = e.target.checked;
                        action(async () => {
                          await (value ? enable() : disable());
                          const actual = await isEnabled();
                          setAuto(actual);
                          if (actual !== value)
                            throw new Error("系统未应用开机启动设置。");
                        });
                      }}
                    />
                    开机启动
                  </label>
                  <p>关闭窗口后可从托盘重新打开。</p>
                </section>
                <section className="card">
                  <h2>本地数据</h2>
                  <p>收入按排班估算，数据仅存于本机。</p>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "清空工资、排班、提成、暂停记录及自定义目标？",
                        ) &&
                        confirm("此操作不可撤销。确认清空？")
                      )
                        action(async () => {
                          await disable();
                          await getCurrentWindow().setAlwaysOnTop(false);
                          await store(empty());
                          setAuto(false);
                          setIsPinned(false);
                          setGoalProgress(null);
                          setPage("home");
                        });
                    }}
                  >
                    清空数据
                  </button>
                </section>
              </>
            )}
          </>
        ) : page === "history" ? (
          <div className="history">
            <div className="row between page-heading">
              <h1>提成记录</h1>
              <button onClick={() => setPage("home")}>返回</button>
            </div>
            <section className="card">
              {!p.commissions.length && <p>暂无提成</p>}
              {[...p.commissions]
                .sort(
                  (a, b) =>
                    b.dateKey.localeCompare(a.dateKey) ||
                    (b.createdAt ?? 0) - (a.createdAt ?? 0),
                )
                .map((c) => (
                  <div className="entry row between" key={c.id}>
                    <div>
                      <strong>{money(c.amountCents / 100)}</strong>
                      <small>{c.dateKey}</small>
                      {c.note && <small>{c.note}</small>}
                    </div>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (confirm("删除这笔提成？"))
                          action(() =>
                            store({
                              ...p,
                              commissions: p.commissions.filter(
                                (x) => x.id !== c.id,
                              ),
                            }),
                          );
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
            </section>
          </div>
        ) : q && status && s ? (
          <div className="home">
            <div className="status">
              <div className="row between home-top">
                <small className="live-date">
                  {today} {weekdayLabel.format(now)}{" "}
                  <time>{localClock.format(now)}</time>
                </small>
                <div className="row">
                  {!windowsShell && controls}
                  <button onClick={settings}>设置</button>
                </div>
              </div>
              <h1 className={status} key={status}>
                {labels[status]}
              </h1>
              <p>{clock}</p>
            </div>
            <div className="earn">
              <small>今日已赚</small>
              <LiveAmount value={q.todayEarned} dailyMaximum={q.dailyBase} />
            </div>
            <p className="hourly">
              当前赚钱速度 <strong>{money(q.hourlyRate / 3600, 4)}/秒</strong>
            </p>
            <p className="motivation">
              {motivation(
                now,
                s,
                q,
                goals.find((goal) => goal.id === activeGoal?.id),
                activeGoal,
              )}
            </p>
            <div className="action">
              {(status === "working" || status === "paused") && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      const t = new Date();
                      const fresh = profileSnapshot(p, t);
                      if (fresh?.status !== status) return;
                      const key = dayKey(t);
                      if (
                        status === "working" &&
                        p.pauses.some(
                          (x) => x.dateKey === key && x.endedAt === null,
                        )
                      ) {
                        throw new Error(
                          "当天已有未结束的暂停，请检查系统时间。",
                        );
                      }
                      const pauses =
                        status === "working"
                          ? [
                              ...p.pauses,
                              {
                                dateKey: key,
                                startedAt: t.getTime(),
                                endedAt: null,
                              },
                            ]
                          : p.pauses.map((x) =>
                              x.dateKey === key && x.endedAt === null
                                ? { ...x, endedAt: t.getTime() }
                                : x,
                            );
                      await store({ ...p, pauses });
                    })
                  }
                >
                  {status === "working" ? "暂停计时" : "继续计时"}
                </button>
              )}
            </div>
            <section className="progress">
              <div className="row between">
                <strong>
                  今日工时进度 <em>{(q.progress * 100).toFixed(1)}%</em>
                </strong>
                <span>
                  已工作 {q.todayWorkedHours.toFixed(2)} /{" "}
                  {q.scheduledHours.toFixed(2)} 小时
                </span>
              </div>
              <progress aria-label="今日工时" value={q.progress} max={1} />
            </section>
            <section className="card month">
              <div className="month-total">
                <small>本月累计</small>
                <strong className="monthly">{money(q.monthlyEarned)}</strong>
              </div>
              <div className="month-meta row between">
                <small>提成 +{money(q.monthlyCommissionEarned)}</small>
                <button
                  className="text-button"
                  onClick={() => setPage("history")}
                >
                  提成记录
                </button>
              </div>
              <div className="month-actions">
                <button onClick={() => setAdding(true)}>＋ 添加提成</button>
                <button
                  className="attendance"
                  aria-label={
                    q.attendanceOn ? "满勤奖：已满勤" : "满勤奖：无满勤"
                  }
                  disabled={busy}
                  aria-pressed={q.attendanceOn}
                  onClick={() =>
                    action(() => store(toggleAttendance(p, new Date())))
                  }
                >
                  <span aria-hidden="true">{q.attendanceOn ? "●" : "○"}</span>{" "}
                  {q.attendanceOn ? "已满勤" : "无满勤"}
                </button>
              </div>
            </section>
            <footer className="home-dates">
              <span>距离周末还有 {daysToSaturday(now)} 天</span>
              <span>
                距离发薪日还有 {daysToPayday(p.settings!.payday, now)} 天
              </span>
            </footer>
          </div>
        ) : null}
      </main>
      {adding && (
        <CommissionForm
          onClose={() => setAdding(false)}
          onSave={(amount, id) =>
            run(() => store(addCommission(p, amount.trim(), new Date(), id)))
          }
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);

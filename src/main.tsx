import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { at, dayKey } from "./domain/earnings";
import {
  addCommission,
  empty,
  needsOnboarding,
  profileSnapshot,
  rules,
  toggleAttendance,
} from "./domain/profile";
import type { Profile } from "./domain/profile";
import { motivation } from "./domain/motivation";
import { Settings } from "./ui/Settings";
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
const calendarLabel = new Intl.DateTimeFormat("zh-CN", {
  month: "long",
  day: "numeric",
  weekday: "short",
});

function App() {
  const [p, setP] = useState<Profile | null>(null);
  const [page, setPage] = useState<"home" | "settings" | "history" | "wizard">(
    "home",
  );
  const [now, setNow] = useState(() => new Date());
  const [adding, setAdding] = useState(false);
  const [auto, setAuto] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
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
        setP(profile);
        if (profile.pinned) await getCurrentWindow().setAlwaysOnTop(true);
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
    if (!p?.settings || page === "history") return;
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
  if (!p) return <main>{error || "正在读取本地数据…"}</main>;
  const s = p.settings ? rules(p.settings) : null;
  const onboarding = needsOnboarding(p);
  const q = page === "home" && !onboarding ? profileSnapshot(p, now) : null;
  const today = dayKey(now);
  const openPause = p.pauses.find(
    (x) => x.dateKey === today && x.endedAt === null,
  );
  const status = q?.status;
  const clock =
    status && q && s
      ? {
          working: () =>
            "距离下班还有 " +
            clockDuration(at(now, s.shiftEnd) - now.getTime()),
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
      const pinned = !p.pinned;
      await window.setAlwaysOnTop(pinned);
      try {
        await store({ ...p, pinned });
      } catch (error) {
        await window.setAlwaysOnTop(p.pinned);
        throw error;
      }
    });
  return (
    <>
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
        ) : page === "settings" ? (
          <>
            <Settings
              profile={p}
              initial={p.settings}
              now={now}
              busy={busy}
              reviewOnboarding={() => setPage("wizard")}
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
            <section className="card">
              <h2>窗口与开机启动</h2>
              <label className="row">
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={p.pinned}
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
                    confirm("清空工资、排班、提成及暂停记录？") &&
                    confirm("此操作不可撤销。确认清空？")
                  )
                    action(async () => {
                      await disable();
                      await getCurrentWindow().setAlwaysOnTop(false);
                      await store(empty());
                      setAuto(false);
                      setPage("home");
                    });
                }}
              >
                清空数据
              </button>
            </section>
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
                <small>{calendarLabel.format(now)}</small>
                <div className="row">
                  <button
                    aria-pressed={p.pinned}
                    disabled={busy}
                    onClick={togglePin}
                  >
                    置顶
                  </button>
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
              当前时薪 <strong>{money(q.hourlyRate)}/小时</strong>
            </p>
            <p className="motivation">{motivation(now, s, q, false)}</p>
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
                <span>今日工时</span>
                <span>
                  {(q.progress * 100).toFixed(1)}% ·{" "}
                  {q.todayWorkedHours.toFixed(1)} /{" "}
                  {Number(q.scheduledHours.toFixed(2))} 小时
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
                <small>
                  提成 +{money(q.monthlyCommissionEarned)}
                  {q.attendanceBonus > 0 && (
                    <> · 满勤 +{money(q.attendanceBonus)}</>
                  )}
                </small>
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
                  disabled={busy}
                  aria-pressed={q.attendanceOn}
                  onClick={() =>
                    action(() => store(toggleAttendance(p, new Date())))
                  }
                >
                  {q.attendanceOn ? "已满勤" : "无满勤"}
                </button>
              </div>
            </section>
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

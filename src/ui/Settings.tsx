import { useState } from "react";
import {
  cents,
  checked,
  paydayInMonth,
  profileSnapshot,
} from "../domain/profile";
import type { Profile, Rules } from "../domain/profile";
import { DayOfMonthPicker } from "./TimePicker";
import { ScheduleFields } from "./ScheduleFields";
import { Chevron } from "./Chevron";
import { money, msg } from "./format";

export function Settings({
  profile,
  initial,
  save,
  close,
  reviewOnboarding,
  manageGoals,
  busy,
  now,
}: {
  profile: Profile;
  initial: Rules;
  save: (rules: Rules) => Promise<void>;
  close: () => void;
  reviewOnboarding: () => void;
  manageGoals: () => void;
  busy: boolean;
  now: Date;
}) {
  const [draft, setDraft] = useState(initial);
  const [salary, setSalary] = useState(String(initial.salaryCents / 100));
  const [bonus, setBonus] = useState(
    String((initial.attendanceCents ?? 0) / 100),
  );
  const [error, setError] = useState("");
  let candidate: Rules | undefined;
  let preview: ReturnType<typeof profileSnapshot> = null;
  try {
    const attendanceCents =
      /^0+(\.0{1,2})?$/.test(bonus.trim()) || !bonus.trim()
        ? 0
        : cents(bonus.trim());
    const next = { ...draft, salaryCents: cents(salary.trim()), attendanceCents };
    checked(next);
    preview = profileSnapshot({ ...profile, settings: next }, now);
    candidate = next;
  } catch {
    /* Invalid draft stays editable, without preview or saving. */
  }
  return (
    <form
      className="settings"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!candidate || busy) return;
        setError("");
        try {
          await save(candidate);
        } catch (err) {
          setError(msg(err));
        }
      }}
    >
      <div className="row between page-heading">
        <h1>设置</h1>
        <button type="button" onClick={close} disabled={busy}>
          返回
        </button>
      </div>
      <button
        type="button"
        className="onboarding-review"
        disabled={busy}
        onClick={reviewOnboarding}
      >
        重新查看新手引导
      </button>
      <button
        className="card goal-link row between"
        type="button"
        onClick={manageGoals}
        disabled={busy}
      >
        <strong>激励目标</strong>
        <span className="goal-link-action">
          管理 <Chevron right />
        </span>
      </button>
      <fieldset className="settings-fields" disabled={busy}>
        <ScheduleFields draft={draft} change={setDraft} />
        <section className="card settings-finance">
          <div className="finance-fields">
            <label>
              税后月薪（元）
              <input
                inputMode="decimal"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
            </label>
            <label>
              满勤奖金（元）
              <input
                inputMode="decimal"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
              />
            </label>
            <div className="settings-payday">
              <small>发薪日</small>
              <DayOfMonthPicker
                value={draft.payday}
                change={(payday) => setDraft((current) => ({ ...current, payday }))}
              />
            </div>
          </div>
          {paydayInMonth(draft.payday, now) !== draft.payday && (
            <small>本月按 {paydayInMonth(draft.payday, now)} 日显示</small>
          )}
          <dl className="preview">
            <div>
              <dt>时薪</dt>
              <dd>{preview ? money(preview.hourlyRate) : "—"}</dd>
            </div>
            <div>
              <dt>今日已赚</dt>
              <dd>{preview ? money(preview.todayEarned) : "—"}</dd>
            </div>
            <div>
              <dt>本月累计</dt>
              <dd>{preview ? money(preview.monthlyEarned) : "—"}</dd>
            </div>
          </dl>
        </section>
      </fieldset>
      {!candidate && (
        <p className="error" role="status">
          请检查金额与排班后保存。
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="settings-actions">
        <button type="button" disabled={busy} onClick={close}>
          取消
        </button>
        <button className="primary" disabled={busy || !candidate}>
          保存设置
        </button>
      </div>
    </form>
  );
}

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
import { money, msg } from "./format";

export function Settings({
  profile,
  initial,
  save,
  close,
  reviewOnboarding,
  busy,
  now,
}: {
  profile: Profile;
  initial: Rules;
  save: (rules: Rules) => Promise<void>;
  close: () => void;
  reviewOnboarding: () => void;
  busy: boolean;
  now: Date;
}) {
  const [draft, setDraft] = useState(initial);
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
    const next = { ...draft, attendanceCents };
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
        if (!candidate) return;
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
      <ScheduleFields draft={draft} change={setDraft} />
      <section className="card settings-finance">
        <div className="finance-fields">
          <label>
            税后月薪（元）
            <input
              key={initial.salaryCents}
              inputMode="decimal"
              defaultValue={initial.salaryCents / 100}
              onChange={(e) => {
                let salaryCents = 0;
                try {
                  salaryCents = cents(e.target.value.trim());
                } catch {
                  /* invalid draft */
                }
                setDraft({ ...draft, salaryCents });
              }}
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
              change={(payday) => setDraft({ ...draft, payday })}
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
      <button className="primary" disabled={busy || !candidate}>
        保存设置
      </button>
    </form>
  );
}

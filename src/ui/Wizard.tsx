import { useState } from "react";
import {
  cents,
  checked,
  dailyMinutes,
  defaults,
  hours,
  paydayInMonth,
} from "../domain/profile";
import type { Profile } from "../domain/profile";
import { money, msg } from "./format";
import { ScheduleFields } from "./ScheduleFields";
import { DayOfMonthPicker } from "./TimePicker";
import logo from "../../assets/logo/app-icon-64.png";

const steps = ["收入设置", "工作时间", "完成"];

export function Wizard({
  profile,
  save,
  busy,
  cancel,
}: {
  profile: Profile;
  save: (p: Profile) => Promise<void>;
  busy: boolean;
  cancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(profile.settings ?? defaults);
  const [salary, setSalary] = useState(
    profile.settings?.salaryCents
      ? String(profile.settings.salaryCents / 100)
      : "",
  );
  const [error, setError] = useState("");
  const currentPayday = paydayInMonth(draft.payday, new Date());
  const validSchedule =
    draft.weekdays.length > 0 && dailyMinutes(draft) !== null;
  return (
    <form
      className={`wizard step-${step}`}
      onSubmit={async (e) => {
        e.preventDefault();
        setError("");
        try {
          if (step === 0) {
            setDraft({ ...draft, salaryCents: cents(salary.trim()) });
            setStep(1);
            return;
          }
          checked(draft);
          if (step === 1) setStep(2);
          else
            await save({
              ...profile,
              settings: draft,
              onboardingCompleted: true,
            });
        } catch (err) {
          setError(msg(err));
        }
      }}
    >
      <div
        className="wizard-progress"
        aria-label={`第 ${step + 1} 步，共 3 步`}
      >
        {steps.map((name, index) => (
          <i key={name} className={index <= step ? "active" : ""} />
        ))}
      </div>
      <section className="wizard-screen" key={step}>
        <div className="step-caption">
          0{step + 1} / 03 · {steps[step]}
        </div>
        {step === 0 && (
          <>
            <h1>每月到手多少？</h1>
            <label className="hero-money">
              <span>每月税后工资</span>
              <span className="money-edit">
                <span aria-hidden="true">¥</span>
                <input
                  aria-label="每月税后工资（元）"
                  autoFocus
                  inputMode="decimal"
                  required
                  value={salary}
                  placeholder="请输入金额"
                  className={salary.length > 9 ? "compact" : ""}
                  onChange={(e) => setSalary(e.target.value)}
                />
              </span>
              <small>收入由工作时间实时换算</small>
            </label>
            {!profile.settings?.salaryCents && !salary.trim() && (
              <dl
                className="unconfigured-preview"
                aria-label="未设置工资的收入预览"
              >
                {["今日已赚", "本月累计", "当前时薪", "提成", "满勤奖"].map(
                  (label) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{money(0)}</dd>
                    </div>
                  ),
                )}
              </dl>
            )}
            <div className="payday-section">
              <h2>发薪日</h2>
              <div className="card payday-row row between">
                <div>
                  <small>每个月</small>
                  <strong>{draft.payday} 日</strong>
                  {currentPayday !== draft.payday && (
                    <small>本月 {currentPayday} 日</small>
                  )}
                </div>
                <DayOfMonthPicker
                  value={draft.payday}
                  change={(payday) => setDraft({ ...draft, payday })}
                >
                  选择日期
                </DayOfMonthPicker>
              </div>
              <p className="wizard-note">工资只在本机计算与保存。</p>
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <h1>你什么时候上班？</h1>
            <ScheduleFields draft={draft} change={setDraft} />
            <p className="wizard-note">点击时间即可滚动选择时、分。</p>
          </>
        )}
        {step === 2 && (
          <>
            <div className="ready-art">
              <div className="ready-icon">
                <img src={logo} alt="" />
                <span aria-hidden="true">✓</span>
              </div>
            </div>
            <h1 className="ready-heading">准备好了。</h1>
            <p className="ready-sub">从今天开始，看看时间值多少钱。</p>
            <section className="summary-card">
              <div className="summary-pay">
                <small>每月到手工资</small>
                <strong>
                  {money(draft.salaryCents / 100)} <small>/ 月</small>
                </strong>
              </div>
              <dl className="summary-grid">
                <div>
                  <dt>每周工作</dt>
                  <dd>{draft.weekdays.length} 天</dd>
                </div>
                <div>
                  <dt>每日有效工时</dt>
                  <dd className="finish-hours">{hours(draft)}</dd>
                </div>
                <div>
                  <dt>上班时段</dt>
                  <dd>
                    {draft.shiftStart}–{draft.shiftEnd}
                  </dd>
                </div>
                <div>
                  <dt>每月发薪</dt>
                  <dd>
                    {draft.payday} 日
                    {currentPayday !== draft.payday && (
                      <small> · 本月 {currentPayday} 日</small>
                    )}
                  </dd>
                </div>
              </dl>
            </section>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <div className="wizard-actions row">
        {cancel && (
          <button
            className="wizard-cancel"
            type="button"
            disabled={busy}
            onClick={cancel}
          >
            取消
          </button>
        )}
        {step > 0 && (
          <button
            className="wizard-back"
            type="button"
            onClick={() => {
              setStep(step - 1);
              setError("");
            }}
          >
            ← 上一步
          </button>
        )}
        <button
          className="primary"
          disabled={busy || (step === 1 && !validSchedule)}
        >
          {step === 2 ? "开始使用 →" : "继续 →"}
        </button>
      </div>
    </form>
  );
}

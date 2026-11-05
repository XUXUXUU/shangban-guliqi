import { dailyMinutes, hours } from "../domain/profile";
import type { Dispatch, SetStateAction } from "react";
import type { Rules } from "../domain/profile";
import { TimePicker } from "./TimePicker";

export const week = ["一", "二", "三", "四", "五", "六", "日"];
export function ScheduleFields({
  draft,
  change,
}: {
  draft: Rules;
  change: Dispatch<SetStateAction<Rules>>;
}) {
  return (
    <div className="schedule">
      <div className="row between">
        <span className="field-title">每周工作日</span>
        <small>{draft.weekdays.length} 天 / 周</small>
      </div>
      <div className="week">
        {week.map((name, index) => {
          const day = index + 1;
          return (
            <button
              key={name}
              type="button"
              aria-label={`周${name}`}
              aria-pressed={draft.weekdays.includes(day)}
              onClick={() =>
                change((current) => ({
                  ...current,
                  weekdays: current.weekdays.includes(day)
                    ? current.weekdays.filter((d) => d !== day)
                    : [...current.weekdays, day],
                }))
              }
            >
              {name}
            </button>
          );
        })}
      </div>
      <section className="card schedule-times">
        <h2>作息时间</h2>
        <div className="grid">
          {(
            [
              ["shiftStart", "上班"],
              ["shiftEnd", "下班"],
              ["lunchStart", "午休开始"],
              ["lunchEnd", "午休结束"],
            ] as const
          ).map(([key, name]) => (
            <TimePicker
              key={key}
              label={name}
              value={draft[key]}
              change={(value) => change((current) => ({ ...current, [key]: value }))}
            />
          ))}
        </div>
        <div className="derived row between">
          <span>每日有效工作时长 · 自动计算</span>
          <output>{hours(draft)}</output>
        </div>
      </section>
      {!draft.weekdays.length && (
        <p className="error" role="alert">
          至少选择一个工作日。
        </p>
      )}
      {dailyMinutes(draft) === null && (
        <p className="error" role="alert">
          午休须在班次内，有效工时须大于零。
        </p>
      )}
    </div>
  );
}

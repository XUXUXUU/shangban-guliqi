import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const ROW = 42;
const two = (value: number) => String(value).padStart(2, "0");

function Wheel({
  label,
  value,
  first = 0,
  last,
  change,
}: {
  label: string;
  value: number;
  first?: number;
  last: number;
  change: (value: number) => void;
}) {
  const wheel = useRef<HTMLDivElement>(null);
  const initial = useRef(value);
  const clamp = (n: number) => Math.max(first, Math.min(last, n));
  useEffect(() => {
    const el = wheel.current;
    if (el) el.scrollTop = (initial.current - first) * ROW;
  }, [first]);

  function select(value: number) {
    const next = clamp(value);
    wheel.current?.scrollTo({ top: (next - first) * ROW, behavior: "instant" });
    change(next);
  }
  return (
    <div className="wheel-column">
      <div className="wheel-label">{label}</div>
      <div className="wheel-shell">
        <div
          className="wheel"
          ref={wheel}
          role="spinbutton"
          aria-label={label}
          aria-valuemin={first}
          aria-valuemax={last}
          aria-valuenow={value}
          tabIndex={0}
          onScroll={(e) =>
            change(clamp(first + Math.round(e.currentTarget.scrollTop / ROW)))
          }
          onKeyDown={(e) => {
            const next = {
              ArrowUp: value - 1,
              ArrowDown: value + 1,
              Home: first,
              End: last,
            }[e.key];
            if (next !== undefined) {
              e.preventDefault();
              select(next);
            }
          }}
        >
          {Array.from({ length: last - first + 1 }, (_, index) => {
            const option = first + index;
            return (
              <button
                type="button"
                key={option}
                tabIndex={-1}
                className={option === value ? "selected" : ""}
                onClick={() => select(option)}
              >
                {two(option)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PickerDialog({
  title,
  hint,
  close,
  confirm,
  children,
}: {
  title: string;
  hint: string;
  close: () => void;
  confirm: () => void;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      className="time-dialog"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="time-panel">
        <div className="row between">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="picker-close"
            aria-label="关闭"
            onClick={close}
          >
            ×
          </button>
        </div>
        <small>{hint}</small>
        <div className="wheel-grid">{children}</div>
        <div className="row between picker-actions">
          <button type="button" onClick={close}>
            取消
          </button>
          <button type="button" className="primary" onClick={confirm}>
            确认
          </button>
        </div>
      </section>
    </dialog>
  );
}

export function TimePicker({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: (value: string) => void;
}) {
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const close = () => setDraft(null);
  return (
    <>
      <button
        className="time-slot"
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label} ${value}`}
        onClick={() => {
          const [h, m] = value.split(":").map(Number);
          setDraft([h, m]);
        }}
      >
        <small>{label}</small>
        <strong>
          {value}
          <span aria-hidden="true">⌄</span>
        </strong>
      </button>
      {draft && (
        <PickerDialog
          title={label}
          hint="滚动选择小时与分钟"
          close={close}
          confirm={() => {
            change(`${two(draft[0])}:${two(draft[1])}`);
            close();
          }}
        >
          <Wheel
            label="时"
            value={draft[0]}
            last={23}
            change={(hour) =>
              setDraft((current) => current && [hour, current[1]])
            }
          />
          <Wheel
            label="分"
            value={draft[1]}
            last={59}
            change={(minute) =>
              setDraft((current) => current && [current[0], minute])
            }
          />
        </PickerDialog>
      )}
    </>
  );
}

export function DayOfMonthPicker({
  value,
  change,
  children,
}: {
  value: number;
  change: (value: number) => void;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const close = () => setDraft(null);
  return (
    <>
      <button
        className="day-trigger"
        type="button"
        aria-haspopup="dialog"
        aria-label={`每个月 ${value} 日`}
        onClick={() => setDraft(value)}
      >
        {children ?? `${value} 日`} <span aria-hidden="true">⌄</span>
      </button>
      {draft !== null && (
        <PickerDialog
          title="每月几号发薪？"
          hint="选择每月的固定发薪日"
          close={close}
          confirm={() => {
            change(draft);
            close();
          }}
        >
          <Wheel
            label="日"
            first={1}
            last={31}
            value={draft}
            change={setDraft}
          />
        </PickerDialog>
      )}
    </>
  );
}

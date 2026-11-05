import { useEffect, useRef, useState } from "react";
import { builtInGoals, makeGoal } from "../domain/motivation";
import type { Goal, GoalOverrides } from "../domain/motivation";
import { money, msg } from "./format";

type Edit = { goal?: Goal; delete?: boolean };

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      aria-hidden="true" focusable="false">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
function RemoveButton({ goal, click }: { goal: Goal; click: () => void }) {
  return (
    <button className="goal-remove" type="button"
      aria-label={`移除 ${goal.name}`} title={`移除 ${goal.name}`}
      onClick={click}>
      <RemoveIcon />
    </button>
  );
}

export function Goals({
  custom,
  builtIn,
  overrides,
  hiddenBuiltInGoalIds,
  close,
  save,
  remove,
  reset,
  restoreHidden,
}: {
  custom: Goal[];
  builtIn: Goal[];
  overrides?: GoalOverrides;
  hiddenBuiltInGoalIds: string[];
  close: () => void;
  save: (goal: Goal) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: (id: string) => Promise<void>;
  restoreHidden: (id: string) => Promise<void>;
}) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const catalogIds = new Set(builtInGoals.map((goal) => goal.id));
  const hidden = new Set(hiddenBuiltInGoalIds);
  const visibleBuiltIn = builtIn.filter((goal) => !hidden.has(goal.id));
  const removedBuiltIn = builtIn.filter((goal) => hidden.has(goal.id));
  return (
    <div className="goals">
      <div className="row between page-heading">
        <h1>激励目标</h1>
        <button type="button" onClick={close}>
          返回
        </button>
      </div>
      <section className="card goals-card" aria-labelledby="custom-goals">
        <div className="row between">
          <h2 id="custom-goals">自定义目标</h2>
          <button
            type="button"
            className="day-trigger"
            onClick={() => setEdit({})}
          >
            添加目标
          </button>
        </div>
        {custom.length === 0 && <small>还没有自定义目标</small>}
        <ul>
          {custom.map((goal) => (
            <li key={goal.id} className="goal-entry">
              <div className="goal-name">
                <strong>{goal.name}</strong>
                <small>{money(goal.priceCents / 100)}</small>
              </div>
              <div className="row">
                <button
                  type="button"
                  aria-label={`编辑 ${goal.name}`}
                  onClick={() => setEdit({ goal })}
                >
                  编辑
                </button>
                <RemoveButton goal={goal} click={() => setEdit({ goal, delete: true })} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card goals-card" aria-labelledby="built-in-goals">
        <h2 id="built-in-goals">内置目标</h2>
        <ul>
          {visibleBuiltIn.map((goal) => (
            <li key={goal.id} className="goal-entry">
              <div className="goal-name">
                <strong>{goal.name}</strong>
                <small>{money(goal.priceCents / 100)}</small>
              </div>
              <div className="row goal-row-actions">
                <button type="button" aria-label={`编辑 ${goal.name}`}
                  onClick={() => setEdit({ goal })}>编辑</button>
                <RemoveButton goal={goal} click={() => setEdit({ goal, delete: true })} />
              </div>
            </li>
          ))}
        </ul>
      </section>
      {removedBuiltIn.length > 0 && (
        <section className="card goals-card">
          <details>
            <summary>已移除目标（{removedBuiltIn.length}）</summary>
            <ul>
              {removedBuiltIn.map((goal) => (
                <li key={goal.id} className="goal-entry">
                  <div className="goal-name">
                    <strong>{goal.name}</strong>
                    <small>{money(goal.priceCents / 100)}</small>
                  </div>
                  <button type="button" onClick={async () => {
                    try {
                      setRestoreError("");
                      await restoreHidden(goal.id);
                    } catch (error) {
                      setRestoreError(msg(error));
                    }
                  }}>恢复</button>
                </li>
              ))}
            </ul>
            {restoreError && <p className="error" role="alert">{restoreError}</p>}
          </details>
        </section>
      )}
      {edit && (
        <GoalDialog
          edit={edit}
          close={() => setEdit(null)}
          save={save}
          remove={remove}
          reset={edit.goal && catalogIds.has(edit.goal.id) && overrides?.[edit.goal.id] ? reset : undefined}
        />
      )}
    </div>
  );
}

function GoalDialog({
  edit,
  close,
  save,
  remove,
  reset,
}: {
  edit: Edit;
  close: () => void;
  save: (goal: Goal) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset?: (id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(edit.goal?.name ?? "");
  const [price, setPrice] = useState(
    edit.goal ? (edit.goal.priceCents / 100).toFixed(2) : "",
  );
  const [error, setError] = useState("");
  useEffect(() => dialog.current?.showModal(), []);
  const title = edit.delete ? "移除目标" : edit.goal ? "编辑目标" : "添加目标";
  return (
    <dialog
      ref={dialog}
      aria-labelledby="goal-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!submitting.current) close();
      }}
    >
      <form
        className="goal-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setBusy(true);
          setError("");
          try {
            const submitter = (e.nativeEvent as SubmitEvent).submitter;
            const restore = submitter?.getAttribute("value") === "restore";
            if (restore && reset && edit.goal) await reset(edit.goal.id);
            else if (edit.delete && edit.goal) await remove(edit.goal.id);
            else
              await save(
                makeGoal(edit.goal?.id ?? crypto.randomUUID(), name, price),
              );
            close();
          } catch (e) {
            setError(msg(e));
          } finally {
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <h2 id="goal-dialog-title">{title}</h2>
        {edit.delete ? (
          <p>{edit.goal?.id.startsWith("builtin:")
            ? `从激励列表移除「${edit.goal?.name}」？之后可以恢复。`
            : `删除自定义目标「${edit.goal?.name}」？`}</p>
        ) : (
          <>
            <label>
              目标名称
              <input
                autoFocus
                aria-required="true"
                maxLength={48}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              价格（元）
              <input
                aria-required="true"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </label>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="row between picker-actions">
          <button
            type="button"
            autoFocus={edit.delete}
            disabled={busy}
            onClick={close}
          >
            取消
          </button>
          <button className="primary" disabled={busy}>
            {edit.delete ? "确认移除" : "保存"}
          </button>
        </div>
        {reset && (
          <button type="submit" value="restore" disabled={busy}>
            恢复默认
          </button>
        )}
      </form>
    </dialog>
  );
}

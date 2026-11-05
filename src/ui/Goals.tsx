import { useEffect, useRef, useState } from "react";
import { makeGoal } from "../domain/motivation";
import type { Goal, GoalOverrides } from "../domain/motivation";
import { money, msg } from "./format";

type Edit = { goal?: Goal; delete?: boolean };

export function Goals({
  custom,
  builtIn,
  overrides,
  close,
  save,
  remove,
  reset,
}: {
  custom: Goal[];
  builtIn: Goal[];
  overrides?: GoalOverrides;
  close: () => void;
  save: (goal: Goal) => Promise<void>;
  remove: (id: string) => Promise<void>;
  reset: (id: string) => Promise<void>;
}) {
  const [edit, setEdit] = useState<Edit | null>(null);
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
                <button
                  type="button"
                  aria-label={`删除 ${goal.name}`}
                  onClick={() => setEdit({ goal, delete: true })}
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <section className="card goals-card" aria-labelledby="built-in-goals">
        <h2 id="built-in-goals">内置目标</h2>
        <ul>
          {builtIn.map((goal) => (
            <li key={goal.id} className="goal-entry">
              <div className="goal-name">
                <strong>{goal.name}</strong>
                <small>{money(goal.priceCents / 100)}</small>
              </div>
              <button
                type="button"
                aria-label={`编辑 ${goal.name}`}
                onClick={() => setEdit({ goal })}
              >
                编辑
              </button>
            </li>
          ))}
        </ul>
      </section>
      {edit && (
        <GoalDialog
          edit={edit}
          close={() => setEdit(null)}
          save={save}
          remove={remove}
          reset={edit.goal && overrides?.[edit.goal.id] ? reset : undefined}
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
  const title = edit.delete ? "删除目标" : edit.goal ? "编辑目标" : "添加目标";
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
          <p>删除「{edit.goal?.name}」？</p>
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
            {edit.delete ? "删除" : "保存"}
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

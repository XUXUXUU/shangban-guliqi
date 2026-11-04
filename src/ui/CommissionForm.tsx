import { useEffect, useRef, useState } from "react";
import { msg } from "./format";

export function CommissionForm({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (amount: string, id: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const submitting = useRef(false);
  const [id] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-label="添加提成"
      onCancel={(e) => {
        e.preventDefault();
        if (!submitting.current) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting.current) onClose();
      }}
    >
      <form
        className="commission-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (submitting.current) return;
          submitting.current = true;
          setBusy(true);
          try {
            await onSave(amount, id);
            onClose();
          } catch (err) {
            setError(msg(err));
            submitting.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          提成金额（元）
          <input
            autoFocus
            required
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          确认添加
        </button>
      </form>
    </dialog>
  );
}

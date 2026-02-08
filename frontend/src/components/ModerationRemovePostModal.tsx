import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert, X } from "lucide-react";
import { ErrorMessage } from "./ErrorMessage";

const REASONS: { value: string; label: string }[] = [
  { value: "spam", label: "Спам" },
  { value: "abuse", label: "Оскорбления" },
  { value: "violence", label: "Насилие" },
  { value: "scam", label: "Мошенничество" },
  { value: "adult", label: "18+ контент" },
  { value: "other", label: "Другое" },
];

export function ModerationRemovePostModal({
  postId,
  onClose,
  onSuccess,
}: {
  postId: string;
  onClose: () => void;
  onSuccess: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<string>(REASONS[0]?.value || "spam");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    setError("");
    if (reason !== "other") setDetails("");
  }, [reason]);

  const canSubmit = useMemo(() => {
    if (!reason) return false;
    if (reason === "other") return details.trim().length > 0;
    return true;
  }, [reason, details]);

  const submit = async () => {
    if (submitting || !canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      const finalReason = reason === "other" ? details.trim() : reason;
      await onSuccess(finalReason);
      onClose();
    } catch (e: any) {
      setError(e?.message || "Не удалось скрыть пост");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[140] w-screen h-screen flex items-center justify-center bg-black/70 backdrop-blur-lg px-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-white/70" strokeWidth={1.7} />
            <span className="text-white font-semibold">Скрыть пост</span>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-2">
            {REASONS.map((r) => (
              <label
                key={r.value}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition ${
                  reason === r.value
                    ? "border-white/30 bg-white/5"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name={`moderation-reason-${postId}`}
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="mt-1 accent-sky-400"
                />
                <span className="text-white text-sm">{r.label}</span>
              </label>
            ))}
          </div>

          {reason === "other" ? (
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Опишите причину"
              className="w-full min-h-[96px] resize-none rounded-xl border border-white/10 bg-black px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30"
            />
          ) : null}

          <ErrorMessage message={error} />

          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-full border border-white/10 py-2 text-sm text-white hover:bg-white/5"
              onClick={onClose}
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={submit}
              className="flex-1 rounded-full border border-white/10 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {submitting ? "Скрываем..." : "Скрыть"}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}


import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ShieldAlert, X } from "lucide-react";
import { ErrorMessage } from "./ErrorMessage";
import { useI18n } from "../i18n";

const REASONS = ["spam", "abuse", "violence", "scam", "adult", "other"] as const;

export function ModerationRemovePostModal({
  postId,
  onClose,
  onSuccess,
}: {
  postId: string;
  onClose: () => void;
  onSuccess: (reason: string) => Promise<void>;
}) {
  const { pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const [reason, setReason] = useState<string>(REASONS[0] || "spam");
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
      setError(e?.message || tr("Постты жасыру мүмкін болмады", "Не удалось скрыть пост", "Failed to hide post"));
    } finally {
      setSubmitting(false);
    }
  };

  const reasonLabel = (value: string) => {
    switch (value) {
      case "spam":
        return tr("Спам", "Спам", "Spam");
      case "abuse":
        return tr("Қорлау", "Оскорбления", "Abuse");
      case "violence":
        return tr("Зорлық", "Насилие", "Violence");
      case "scam":
        return tr("Алаяқтық", "Мошенничество", "Scam");
      case "adult":
        return tr("18+ контент", "18+ контент", "18+ content");
      default:
        return tr("Басқа", "Другое", "Other");
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
            <span className="text-white font-semibold">{tr("Постты жасыру", "Скрыть пост", "Hide post")}</span>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="space-y-2">
            {REASONS.map((r) => (
              <label
                key={r}
                className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition ${
                  reason === r
                    ? "border-white/30 bg-white/5"
                    : "border-white/10 hover:border-white/20"
                }`}
              >
                <input
                  type="radio"
                  name={`moderation-reason-${postId}`}
                  value={r}
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="mt-1 accent-sky-400"
                />
                <span className="text-white text-sm">{reasonLabel(r)}</span>
              </label>
            ))}
          </div>

          {reason === "other" ? (
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder={tr("Себебін жазыңыз", "Опишите причину", "Describe the reason")}
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
              {tr("Бас тарту", "Отмена", "Cancel")}
            </button>
            <button
              type="button"
              disabled={!canSubmit || submitting}
              onClick={submit}
              className="flex-1 rounded-full border border-white/10 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50 disabled:hover:bg-transparent"
            >
              {submitting ? tr("Жасырылуда...", "Скрываем...", "Hiding...") : tr("Жасыру", "Скрыть", "Hide")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

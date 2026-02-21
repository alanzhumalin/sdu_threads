import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "../i18n";

type Props = {
  message?: string | null;
  onClose?: () => void;
  className?: string;
};

export function ErrorMessage({ message, onClose, className = "" }: Props) {
  const { pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  if (!message) return null;

  return (
    <div
      className={
        "flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200 " +
        className
      }
      role="alert"
      aria-live="polite"
    >
      <AlertTriangle className="w-4 h-4 mt-0.5 text-red-300 flex-shrink-0" />
      <div className="flex-1 leading-snug">{message}</div>
      {onClose && (
        <button
          type="button"
          className="text-red-200/70 hover:text-red-200"
          onClick={onClose}
          aria-label={tr("Жабу", "Закрыть", "Close")}
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

import { createPortal } from "react-dom";
import { X } from "lucide-react";

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  loading?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  loading = false,
  danger = false,
  onConfirm,
  onClose,
}: Props) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[240] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b0b0f] shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-white font-semibold">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full border border-white/15 bg-white/5 text-white/70 hover:text-white hover:bg-white/10"
            aria-label={cancelLabel}
          >
            <X className="w-4 h-4 mx-auto" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-white/70">{description}</p>
        </div>
        <div className="px-5 pb-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white/80 hover:text-white hover:border-white/35 transition disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`rounded-full border px-4 py-2 text-sm transition disabled:opacity-60 ${
              danger
                ? "border-red-400/45 bg-red-500/20 text-red-100 hover:bg-red-500/30"
                : "border-white text-black bg-white hover:bg-white/90"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

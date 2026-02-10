import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Lock, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuthGateStore } from "../store/authGate";

export function AuthGateModal() {
  const navigate = useNavigate();
  const open = useAuthGateStore((s) => s.open);
  const title = useAuthGateStore((s) => s.title);
  const message = useAuthGateStore((s) => s.message);
  const ctaLabel = useAuthGateStore((s) => s.ctaLabel);
  const hide = useAuthGateStore((s) => s.hide);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, hide]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[160] w-screen h-screen flex items-center justify-center bg-black/70 backdrop-blur-lg px-3"
      onClick={hide}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-white/70" strokeWidth={1.7} />
            <span className="text-white font-semibold">{title || "Сначала авторизуйся"}</span>
          </div>
          <button onClick={hide} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-white/70">{message || "Чтобы продолжить, нужно войти в аккаунт."}</p>
          <button
            type="button"
            onClick={() => {
              hide();
              navigate("/login");
            }}
            className="w-full rounded-full border border-white/10 py-2 text-sm text-white hover:bg-white/5"
          >
            {ctaLabel || "Войти"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}


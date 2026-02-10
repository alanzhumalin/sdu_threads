import { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";

type Props = {
  children: ReactNode;
  title?: string;
  message?: string;
  ctaLabel?: string;
  mode?: "local" | "page";
  className?: string;
};

export function AuthGateOverlay({
  children,
  title = "Сначала авторизуйся",
  message = "Чтобы продолжить, нужно войти в аккаунт.",
  ctaLabel = "Войти",
  mode = "local",
  className = "",
}: Props) {
  const navigate = useNavigate();
  // Keep page-level gate below navigation (sidebar z-30, mobile bottom nav z-[120])
  // so users can still navigate back to feed without being trapped by the overlay.
  const overlayPositionClass = mode === "page" ? "fixed inset-0 z-20" : "absolute inset-0 z-10";

  return (
    <div className={`relative ${className}`}>
      <div className="pointer-events-none select-none blur-sm opacity-60">{children}</div>
      <div className={`${overlayPositionClass} flex items-center justify-center`}>
        <div className="absolute inset-0 bg-black/40" />
        <div className="relative z-10 mx-4 w-full max-w-sm rounded-2xl border border-white/10 bg-black/80 p-5 text-center shadow-2xl backdrop-blur">
          <Lock className="mx-auto mb-3 h-6 w-6 text-white/80" strokeWidth={1.7} />
          <p className="text-white font-semibold">{title}</p>
          <p className="mt-1 text-sm text-white/60">{message}</p>
          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-4 w-full rounded-full border border-white/10 py-2 text-sm text-white hover:bg-white/5"
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

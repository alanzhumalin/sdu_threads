import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { VerifiedBadge } from "./VerifiedBadge";

type Props = {
  username: string;
  children: React.ReactNode;
  className?: string;
};

type Profile = {
  full_name?: string;
  is_verified?: boolean;
  username: string;
  avatar_url?: string;
  background_url?: string;
  followers?: number;
  following?: number;
  created_at?: string;
};

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export function MentionPreview({ username, children, className }: Props) {
  const token = useAuthStore((s) => s.token);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Profile | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; place: "top" | "bottom" }>({
    top: 0,
    left: 0,
    place: "bottom",
  });
  const closeTimer = useRef<number | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);

  const clearTimer = () => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const handleEnter = () => {
    clearTimer();
    const el = anchorRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const viewH = window.innerHeight || document.documentElement.clientHeight;
    const ratio = rect.top / viewH;
    // ниже середины +30% — открываем вверх
    const place: "top" | "bottom" = ratio > 0.6 ? "top" : "bottom";
    const left = clamp(rect.left - 8, 8, (window.innerWidth || 1200) - 300);
    const top = place === "top" ? rect.top : rect.bottom;
    setPos({ top, left, place });
    setOpen(true);
    if (!data && !loading) {
      setLoading(true);
      api
        .profileByUsername(username, token)
        .then((p) =>
          setData({
            full_name: p.full_name,
            is_verified: p.is_verified,
            username: p.username,
            avatar_url: p.avatar_url,
            background_url: p.background_url,
            followers: p.followers,
            following: p.following,
            created_at: p.created_at,
          })
        )
        .catch(() => {})
        .finally(() => setLoading(false));
    }
  };

  const scheduleClose = () => {
    clearTimer();
    closeTimer.current = window.setTimeout(() => setOpen(false), 80);
  };

  useEffect(() => {
    if (!open) return;
    const onScroll = () => {
      clearTimer();
      setOpen(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimer();
    };
  }, [open]);

  const content = open ? (
    <div
      ref={popupRef}
      onMouseEnter={handleEnter}
      onMouseLeave={scheduleClose}
      style={{
        position: "fixed",
        top: pos.top,
        left: pos.left,
        zIndex: 1000,
        width: 280,
        transform: pos.place === "top" ? "translateY(calc(-100% - 10px))" : "translateY(8px)",
      }}
      className="rounded-2xl border border-white/10 bg-black/90 shadow-2xl overflow-hidden backdrop-blur"
    >
      <div className="relative h-20 bg-gradient-to-r from-white/10 to-white/5">
        {data?.background_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.background_url}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : null}
       <div className="absolute -bottom-7 left-4 w-14 h-14 rounded-full bg-black border border-white/20 overflow-hidden flex items-center justify-center text-sm font-semibold">
          {data?.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            (data?.full_name?.[0] || username[0] || "U").toUpperCase()
          )}
        </div>
      </div>
      <div className="pt-8 px-4 pb-4 space-y-1 text-white">
        <p className="font-semibold leading-tight inline-flex items-center gap-[3px]">
          <span>{data?.full_name || username}</span>
          {data?.is_verified ? <VerifiedBadge /> : null}
        </p>
        <p className="text-white/60 text-sm">@{username}</p>
        {data?.created_at && (
          <p className="text-white/50 text-xs">
            на сайте с {new Date(data.created_at).toLocaleDateString()}
          </p>
        )}
        <div className="flex items-center gap-3 text-sm text-white/70 pt-1">
          <span>
            <span className="font-semibold text-white">{data?.followers ?? "—"}</span> подписчиков
          </span>
          <span>
            <span className="font-semibold text-white">{data?.following ?? "—"}</span> подписки
          </span>
        </div>
        {loading && <p className="text-white/50 text-xs pt-1">Загрузка...</p>}
      </div>
    </div>
  ) : null;

  return (
    <>
      <span
        ref={anchorRef}
        onMouseEnter={handleEnter}
        onMouseLeave={scheduleClose}
        className={`relative inline-flex ${
          typeof className === "string" ? className : "text-purple-400 font-semibold hover:underline"
        }`}
      >
        {children}
      </span>
      {open && content ? createPortal(content, document.body) : null}
    </>
  );
}

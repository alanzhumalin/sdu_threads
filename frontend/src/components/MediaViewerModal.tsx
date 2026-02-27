import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

type ViewerItem = {
  url: string;
  type?: "image" | "video";
};

type Props = {
  items?: ViewerItem[];
  urls?: string[];
  initialIndex?: number;
  onClose: () => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

const isVideoByURL = (url: string) => {
  const normalized = String(url || "").toLowerCase().split("?")[0]?.split("#")[0] || "";
  return /\.(mp4|webm|mov|m4v|avi|mkv|3gp|ogv)$/.test(normalized);
};

const normalizeType = (item: ViewerItem): "image" | "video" => {
  if (item.type === "video" || item.type === "image") return item.type;
  return isVideoByURL(item.url) ? "video" : "image";
};

export function MediaViewerModal({ items, urls, initialIndex = 0, onClose }: Props) {
  const normalizedItems = useMemo<ViewerItem[]>(() => {
    if (Array.isArray(items) && items.length > 0) {
      return items.filter((item) => Boolean(item?.url));
    }
    return Array.isArray(urls) ? urls.filter(Boolean).map((url) => ({ url })) : [];
  }, [items, urls]);

  const count = normalizedItems.length;
  const safeInitial = useMemo(() => clamp(initialIndex, 0, Math.max(0, count - 1)), [initialIndex, count]);
  const [idx, setIdx] = useState(safeInitial);
  const startX = useRef<number | null>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => setIdx(safeInitial), [safeInitial]);

  const prev = () => setIdx((i) => (count === 0 ? 0 : (i - 1 + count) % count));
  const next = () => setIdx((i) => (count === 0 ? 0 : (i + 1) % count));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (count <= 1) return;
      if (e.key === "ArrowLeft") prev();
      if (e.key === "ArrowRight") next();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [count, onClose]);

  if (count === 0) return null;
  const current = normalizedItems[idx]!;
  const currentType = normalizeType(current);

  return createPortal(
    <div
      className="fixed inset-0 z-[140] bg-black/80 backdrop-blur-lg flex items-center justify-center p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-5xl">
        <div
          className="relative w-full h-[70vh] md:h-[80vh] rounded-2xl border border-white/10 bg-black/95 overflow-hidden flex items-center justify-center"
          onTouchStart={(e) => {
            const t = e.touches[0];
            if (!t) return;
            startX.current = t.clientX;
            startY.current = t.clientY;
          }}
          onTouchEnd={(e) => {
            if (count <= 1) return;
            const sx = startX.current;
            const sy = startY.current;
            startX.current = null;
            startY.current = null;
            const t = e.changedTouches[0];
            if (sx == null || sy == null || !t) return;
            const dx = t.clientX - sx;
            const dy = t.clientY - sy;
            if (Math.abs(dx) < 40) return;
            if (Math.abs(dx) < Math.abs(dy)) return;
            if (dx > 0) prev();
            else next();
          }}
        >
          {currentType === "video" ? (
            <video
              key={`${current.url}-${idx}`}
              src={current.url}
              className="w-full h-full object-contain"
              controls
              autoPlay
              playsInline
              preload="metadata"
            />
          ) : (
            <img
              src={current.url}
              alt="media"
              className="w-full h-full object-contain select-none"
              draggable={false}
            />
          )}

          <div className="absolute top-3 left-1/2 -translate-x-1/2 text-xs text-white/80 bg-black/70 border border-white/10 rounded-full px-3 py-1">
            {idx + 1}/{count}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 inline-flex items-center justify-center w-9 h-9 rounded-full bg-black/70 border border-white/10 text-white/80 hover:text-white hover:border-white/20"
            aria-label="close"
          >
            <X className="w-5 h-5" />
          </button>

          {count > 1 && (
            <>
              <button
                type="button"
                onClick={prev}
                className="hidden md:inline-flex absolute left-3 top-1/2 -translate-y-1/2 items-center justify-center w-10 h-10 rounded-full bg-black/70 border border-white/10 text-white/80 hover:text-white hover:border-white/20"
                aria-label="prev"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={next}
                className="hidden md:inline-flex absolute right-3 top-1/2 -translate-y-1/2 items-center justify-center w-10 h-10 rounded-full bg-black/70 border border-white/10 text-white/80 hover:text-white hover:border-white/20"
                aria-label="next"
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            </>
          )}
        </div>

        {count > 1 && (
          <div className="mt-3 flex items-center justify-center gap-2">
            {normalizedItems.map((_, i) => (
              <button
                key={i}
                type="button"
                className={`w-2 h-2 rounded-full transition ${
                  i === idx ? "bg-white/80" : "bg-white/25 hover:bg-white/40"
                }`}
                onClick={() => setIdx(i)}
                aria-label={`open ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

import { useMemo, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
import { MediaViewerModal } from "./MediaViewerModal";
import type { MediaItem } from "../types/media";

type Props = {
  media?: MediaItem[];
  className?: string;
};

const isVideoByURL = (url: string) => {
  const normalized = String(url || "").toLowerCase().split("?")[0]?.split("#")[0] || "";
  return /\.(mp4|webm|mov|m4v|avi|mkv|3gp|ogv)$/.test(normalized);
};

const mediaKind = (item: MediaItem): "image" | "video" => {
  if (item.type === "video" || item.type === "image") return item.type;
  return isVideoByURL(item.url) ? "video" : "image";
};

export function PostMedia({ media, className }: Props) {
  const items = useMemo<MediaItem[]>(() => (Array.isArray(media) ? media : []), [media]);
  const viewerItems = useMemo(
    () =>
      items
        .map((item) => ({ url: item.url, type: mediaKind(item) }))
        .filter((item) => Boolean(item.url)),
    [items]
  );

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [unmuted, setUnmuted] = useState<Record<string, boolean>>({});

  const openAt = (idx: number) => {
    setActive(idx);
    setOpen(true);
  };

  const closeViewer = () => {
    setOpen(false);
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  if (items.length === 0) return null;

  const outerCls = `mt-4 overflow-hidden rounded-2xl ${className ?? ""}`;
  const hCls = "h-[320px] md:h-[420px]";

  const ratioOf = (it: MediaItem) => {
    const w = Number(it.width);
    const h = Number(it.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w / h;
    return 1;
  };

  const aspectStr = (it: MediaItem) => {
    const w = Number(it.width);
    const h = Number(it.height);
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return `${w} / ${h}`;
    return undefined;
  };

  const tile = (
    it: MediaItem,
    idx: number,
    extraOverlay?: string,
    opts?: { tileAspect?: number; fit?: "contain" | "cover" }
  ) => {
    const tileAspect = opts?.tileAspect;
    const hasTileAspect = typeof tileAspect === "number" && tileAspect > 0;
    const fit = opts?.fit ?? "contain";
    const kind = mediaKind(it);
    const key = `${it.url}-${idx}`;
    const isUnmuted = Boolean(unmuted[key]);

    return (
      <div
        key={key}
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          openAt(idx);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openAt(idx);
          }
        }}
        className={`relative w-full ${hasTileAspect ? "" : "h-full"} min-w-0 min-h-0 overflow-hidden flex items-center justify-center bg-black/20 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 cursor-pointer`}
        style={hasTileAspect ? { aspectRatio: tileAspect } : undefined}
      >
        {kind === "video" ? (
          <video
            src={it.url}
            className={`w-full h-full min-w-0 min-h-0 ${fit === "cover" ? "object-cover" : "object-contain object-center"}`}
            autoPlay
            loop
            playsInline
            preload="metadata"
            muted={!isUnmuted}
          />
        ) : (
          <img
            src={it.url}
            alt="media"
            width={it.width || undefined}
            height={it.height || undefined}
            className={`w-full h-full min-w-0 min-h-0 ${fit === "cover" ? "object-cover" : "object-contain object-center"}`}
            draggable={false}
            loading="lazy"
            decoding="async"
          />
        )}
        {kind === "video" ? (
          <button
            type="button"
            aria-label={isUnmuted ? "Выключить звук видео" : "Включить звук видео"}
            title={isUnmuted ? "Выключить звук видео" : "Включить звук видео"}
            onClick={(e) => {
              e.stopPropagation();
              setUnmuted((prev) => ({ ...prev, [key]: !prev[key] }));
            }}
            className="absolute bottom-2 right-2 z-10 rounded-full border border-white/20 bg-black/55 p-1.5 text-white/90 hover:bg-black/70"
          >
            {isUnmuted ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        ) : null}
        {extraOverlay ? (
          <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-2xl font-semibold">
            {extraOverlay}
          </span>
        ) : null}
      </div>
    );
  };

  let grid: JSX.Element;
  if (items.length === 1) {
    const it = items[0]!;
    const w = Number(it.width);
    const h = Number(it.height);
    const hasDims = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
    const isPortrait = hasDims && h > w;
    const portraitHeightCls = isPortrait ? "h-[330px] md:h-[600px]" : "";
    grid = (
      <div
        className={`w-full overflow-hidden bg-black/20 ${hasDims ? "" : hCls} ${portraitHeightCls}`.trim()}
        style={!isPortrait && aspectStr(it) ? { aspectRatio: aspectStr(it) } : undefined}
      >
        {tile(it, 0, undefined, { fit: isPortrait ? "contain" : "cover" })}
      </div>
    );
  } else if (items.length === 2) {
    const tileAspect = Math.min(ratioOf(items[0]!), ratioOf(items[1]!)) || 1;
    grid = (
      <div className="grid grid-cols-2 gap-[2px] w-full">
        {tile(items[0]!, 0, undefined, { tileAspect, fit: "contain" })}
        {tile(items[1]!, 1, undefined, { tileAspect, fit: "contain" })}
      </div>
    );
  } else if (items.length === 3) {
    grid = (
      <div className={`grid grid-cols-2 grid-rows-2 gap-[2px] w-full ${hCls}`}>
        <div className="row-span-2">{tile(items[0]!, 0, undefined, { fit: "cover" })}</div>
        {tile(items[1]!, 1, undefined, { fit: "cover" })}
        {tile(items[2]!, 2, undefined, { fit: "cover" })}
      </div>
    );
  } else {
    const extra = items.length - 4;
    grid = (
      <div className={`grid grid-cols-2 grid-rows-2 gap-[2px] w-full ${hCls}`}>
        {tile(items[0]!, 0, undefined, { fit: "cover" })}
        {tile(items[1]!, 1, undefined, { fit: "cover" })}
        {tile(items[2]!, 2, undefined, { fit: "cover" })}
        {tile(items[3]!, 3, extra > 0 ? `+${extra}` : undefined, { fit: "cover" })}
      </div>
    );
  }

  return (
    <>
      <div className={outerCls}>{grid}</div>
      {open && <MediaViewerModal items={viewerItems} initialIndex={active} onClose={closeViewer} />}
    </>
  );
}

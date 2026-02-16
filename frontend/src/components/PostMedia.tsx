import { useMemo, useState } from "react";
import { MediaViewerModal } from "./MediaViewerModal";
import type { MediaItem } from "../types/media";

type Props = {
  media?: MediaItem[];
  className?: string;
};

export function PostMedia({ media, className }: Props) {
  const items = useMemo<MediaItem[]>(() => {
    return Array.isArray(media) ? media : [];
  }, [media]);

  const list = useMemo(() => items.map((i) => i.url).filter(Boolean), [items]);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const openAt = (idx: number) => {
    setActive(idx);
    setOpen(true);
  };

  const closeViewer = () => {
    setOpen(false);
    // Prevent a persistent focus outline on the clicked tile after closing the viewer.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  };

  if (items.length === 0) return null;

  // No borders here: the post card already has an outer border, and inner borders look "double".
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
    return (
      <button
        key={`${it.url}-${idx}`}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          openAt(idx);
        }}
        className={`relative w-full ${hasTileAspect ? "" : "h-full"} overflow-hidden flex items-center justify-center bg-black/20 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0`}
        style={hasTileAspect ? { aspectRatio: tileAspect } : undefined}
      >
        <img
          src={it.url}
          alt="media"
          width={it.width || undefined}
          height={it.height || undefined}
          style={aspectStr(it) ? { aspectRatio: aspectStr(it) } : undefined}
          className={`w-full h-full ${fit === "cover" ? "object-cover" : "object-contain"}`}
          draggable={false}
          loading="lazy"
          decoding="async"
        />
        {extraOverlay ? (
          <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-white text-2xl font-semibold">
            {extraOverlay}
          </span>
        ) : null}
      </button>
    );
  };

  let grid: JSX.Element;
  if (items.length === 1) {
    const it = items[0]!;
    const w = Number(it.width);
    const h = Number(it.height);
    const hasDims = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
    const isPortrait = hasDims && h > w;
    const portraitHeightCls = isPortrait ? "max-h-[330px] md:max-h-[600px]" : "";
    grid = (
      <div
        className={`w-full bg-black/20 ${hasDims ? "" : hCls} ${portraitHeightCls}`.trim()}
        style={aspectStr(it) ? { aspectRatio: aspectStr(it) } : undefined}
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
      {open && <MediaViewerModal urls={list} initialIndex={active} onClose={closeViewer} />}
    </>
  );
}

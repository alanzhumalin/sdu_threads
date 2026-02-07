import { useEffect, useMemo, useRef, useState } from "react";
import {
  Crop,
  Droplets,
  Move,
  Paintbrush,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { fabric } from "fabric";

type Mode = "move" | "draw" | "crop" | "blur";
type CropPreset = "free" | "1:1" | "4:3" | "16:9";
type Variant = "full" | "cropOnly";
type CropFrame = { left: number; top: number; width: number; height: number };

type Props = {
  src: string;
  fileName: string;
  onCancel: () => void;
  onSave: (file: File) => void;
  variant?: Variant;
  title?: string;
  fixedCropRatio?: number;
  initialMode?: Mode;
  initialCropPreset?: CropPreset;
  cropMask?: "circle" | null;
};

const BRUSH_SIZES = [3, 6, 10, 16];
const COLORS = ["#ffffff", "#000000", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#0ea5e9"];
const MAX_EXPORT_MULTIPLIER = 2;
const MAX_ZOOM_FULL = 6;
const MAX_ZOOM_CROP_ONLY = 12;

let forcedCanvas2dFilters = false;

const ensureCanvas2dFilters = () => {
  if (forcedCanvas2dFilters) return;
  const f: any = fabric as any;
  if (!f?.Canvas2dFilterBackend) return;
  // Avoid WebGL filter artifacts (black stripes) on some setups.
  f.enableGLFiltering = false;
  f.filterBackend = new f.Canvas2dFilterBackend();
  forcedCanvas2dFilters = true;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const cropRatioValue = (preset: CropPreset): number | null => {
  switch (preset) {
    case "1:1":
      return 1;
    case "4:3":
      return 4 / 3;
    case "16:9":
      return 16 / 9;
    default:
      return null;
  }
};

const stripExt = (name: string) => name.replace(/\.[^/.]+$/, "");

export default function FabricImageEditor({
  src,
  fileName,
  onCancel,
  onSave,
  variant = "full",
  title = "Редактирование",
  fixedCropRatio,
  initialMode,
  initialCropPreset = "free",
  cropMask = null,
}: Props) {
  const effectiveInitialMode: Mode = initialMode ?? (variant === "cropOnly" ? "crop" : "move");

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const canvasRef = useRef<fabric.Canvas | null>(null);
  const bgRef = useRef<fabric.Image | null>(null);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const cropFrameRef = useRef<CropFrame | null>(null);
  const cropInitRef = useRef(false);
  const cropUserInteractedRef = useRef(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<Mode>("move");
  const [brushSize, setBrushSize] = useState<number>(BRUSH_SIZES[1]);
  const [brushColor, setBrushColor] = useState<string>(COLORS[0]);
  const [cropPreset, setCropPreset] = useState<CropPreset>(initialCropPreset);
  const [blurPx, setBlurPx] = useState<number>(8);
  const [brightness, setBrightness] = useState<number>(0); // [-1..1]
  const [contrast, setContrast] = useState<number>(0); // [-1..1]
  const [saturation, setSaturation] = useState<number>(0); // [-1..1]
  const [angle, setAngle] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hasCropSelection, setHasCropSelection] = useState(false);
  const [hasBlurSelection, setHasBlurSelection] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [cropFrame, setCropFrame] = useState<CropFrame | null>(null);

  const modeRef = useRef<Mode>("move");
  const cropPresetRef = useRef<CropPreset>("free");
  const cropRectRef = useRef<fabric.Rect | null>(null);
  const blurRectRef = useRef<fabric.Rect | null>(null);
  const blurPreviewRef = useRef<fabric.Image | null>(null);
  const isDraggingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const spaceDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const prevDrawingRef = useRef(false);
  const blurPxRef = useRef(blurPx);
  const filterRafRef = useRef<number | null>(null);
  const anglePreviewRafRef = useRef<number | null>(null);
  const angleDraggingRef = useRef(false);
  const blurPreviewRafRef = useRef<number | null>(null);
  const blurPreviewBusyRef = useRef(false);
  const blurPreviewPendingRef = useRef(false);
  const viewSnapshotTimerRef = useRef<number | null>(null);
  const historyRef = useRef<{
    undo: Array<{
      baseSrc: string;
      natural: { w: number; h: number };
      brightness: number;
      contrast: number;
      saturation: number;
      objects: any[];
      vpt: number[];
    }>;
    redo: Array<{
      baseSrc: string;
      natural: { w: number; h: number };
      brightness: number;
      contrast: number;
      saturation: number;
      objects: any[];
      vpt: number[];
    }>;
  }>({ undo: [], redo: [] });

  const computeFixedCropFrame = (w: number, h: number): CropFrame => {
    // In crop-only flow we show a fixed frame and let the user pan/zoom the image underneath.
    // The frame is centered and sized relative to the visible canvas size.
    const maxZoom = variant === "cropOnly" ? MAX_ZOOM_CROP_ONLY : MAX_ZOOM_FULL;
    const base = getBaseRect();

    if (cropMask === "circle") {
      const raw = Math.floor(Math.min(w, h) * 0.72);
      let size = clamp(raw, 180, 420);
      if (variant === "cropOnly" && base) {
        const maxAllowed = Math.floor(Math.min(base.width, base.height) * maxZoom);
        size = Math.max(120, Math.min(size, maxAllowed));
      }
      return {
        left: Math.floor((w - size) / 2),
        top: Math.floor((h - size) / 2),
        width: size,
        height: size,
      };
    }

    const ratio = fixedCropRatio && fixedCropRatio > 0 ? fixedCropRatio : 1;
    const maxW = Math.floor(w * 0.92);
    const maxH = Math.floor(h * 0.82);
    let frameW = maxW;
    let frameH = Math.floor(frameW / ratio);
    if (frameH > maxH) {
      frameH = maxH;
      frameW = Math.floor(frameH * ratio);
    }
    if (variant === "cropOnly" && base) {
      const maxAllowedW = Math.floor(base.width * maxZoom);
      const maxAllowedH = Math.floor(base.height * maxZoom);
      frameW = Math.min(frameW, maxAllowedW, Math.floor(maxAllowedH * ratio));
      frameH = Math.floor(frameW / ratio);
    }
    frameW = clamp(frameW, 160, maxW);
    frameH = clamp(frameH, 120, maxH);
    return {
      left: Math.floor((w - frameW) / 2),
      top: Math.floor((h - frameH) / 2),
      width: frameW,
      height: frameH,
    };
  };

  const clampViewportToCoverFrame = (vpt?: number[]) => {
    if (variant !== "cropOnly") return;
    const c = canvasRef.current;
    const frame = cropFrameRef.current;
    const base = getBaseRect();
    if (!c || !frame || !base) return;
    const next = vpt ? [...vpt] : c.viewportTransform ? [...c.viewportTransform] : [1, 0, 0, 1, 0, 0];
    const z = typeof next[0] === "number" ? next[0] : 1;
    let tx = typeof next[4] === "number" ? next[4] : 0;
    let ty = typeof next[5] === "number" ? next[5] : 0;

    const baseLeft = base.left * z + tx;
    const baseTop = base.top * z + ty;
    const baseRight = (base.left + base.width) * z + tx;
    const baseBottom = (base.top + base.height) * z + ty;
    const frameLeft = frame.left;
    const frameTop = frame.top;
    const frameRight = frame.left + frame.width;
    const frameBottom = frame.top + frame.height;

    if (baseLeft > frameLeft) tx += frameLeft - baseLeft;
    if (baseTop > frameTop) ty += frameTop - baseTop;
    if (baseRight < frameRight) tx += frameRight - baseRight;
    if (baseBottom < frameBottom) ty += frameBottom - baseBottom;

    next[4] = tx;
    next[5] = ty;
    c.setViewportTransform(next as any);
    c.requestRenderAll();
  };

  const cropOnlyZoomBounds = () => {
    const max = variant === "cropOnly" ? MAX_ZOOM_CROP_ONLY : MAX_ZOOM_FULL;
    let min = 0.25;
    if (variant === "cropOnly" && modeRef.current === "crop") {
      const frame = cropFrameRef.current;
      const base = getBaseRect();
      if (frame && base && base.width > 0 && base.height > 0) {
        min = Math.max(frame.width / base.width, frame.height / base.height);
      }
    }
    min = clamp(min, 0.25, max);
    return { min, max };
  };

  const enforceCropOnlyZoomAndClamp = () => {
    if (variant !== "cropOnly") return;
    const c = canvasRef.current;
    if (!c) return;
    const { min, max } = cropOnlyZoomBounds();
    const cur = c.getZoom();
    const next = clamp(cur, min, max);
    if (Math.abs(next - cur) > 0.0001) {
      c.zoomToPoint(new fabric.Point(c.getWidth() / 2, c.getHeight() / 2), next);
      setZoom(Number(next.toFixed(2)));
      cropUserInteractedRef.current = true;
    }
    if (modeRef.current === "crop") clampViewportToCoverFrame();
  };

  const initCropOnlyView = () => {
    if (variant !== "cropOnly") return;
    if (cropInitRef.current) return;
    const c = canvasRef.current;
    const frame = cropFrameRef.current;
    const base = getBaseRect();
    if (!c || !frame || !base) return;

    // Start from a clean view.
    c.setViewportTransform([1, 0, 0, 1, 0, 0]);

    // Zoom in so the base image covers the entire frame (no empty areas).
    const needZoom = Math.max(frame.width / Math.max(1, base.width), frame.height / Math.max(1, base.height));
    const { min, max } = cropOnlyZoomBounds();
    const nextZoom = clamp(needZoom, min, max);
    c.zoomToPoint(new fabric.Point(c.getWidth() / 2, c.getHeight() / 2), nextZoom);
    setZoom(Number(nextZoom.toFixed(2)));

    // Center the image under the fixed frame.
    const vpt = c.viewportTransform ? [...c.viewportTransform] : [nextZoom, 0, 0, nextZoom, 0, 0];
    const baseCx = base.left + base.width / 2;
    const baseCy = base.top + base.height / 2;
    // @ts-expect-error - util typings are loose in v4
    const screenBase = fabric.util.transformPoint(new fabric.Point(baseCx, baseCy), vpt as any) as any;
    const frameCx = frame.left + frame.width / 2;
    const frameCy = frame.top + frame.height / 2;
    vpt[4] += frameCx - screenBase.x;
    vpt[5] += frameCy - screenBase.y;
    c.setViewportTransform(vpt as any);
    clampViewportToCoverFrame(vpt);

    cropInitRef.current = true;
  };

  const exportCropFrameDataUrl = () => {
    const c = canvasRef.current;
    const frame = cropFrameRef.current;
    if (!c || !frame) return null;
    const base = getBaseRect();
    if (!base) return null;
    const vpt = c.viewportTransform ? [...c.viewportTransform] : [1, 0, 0, 1, 0, 0];
    // @ts-expect-error - util typings are loose in v4
    const inv = fabric.util.invertTransform(vpt as any) as any;
    // @ts-expect-error - util typings are loose in v4
    const p1 = fabric.util.transformPoint(new fabric.Point(frame.left, frame.top), inv) as any;
    // @ts-expect-error - util typings are loose in v4
    const p2 = fabric.util.transformPoint(new fabric.Point(frame.left + frame.width, frame.top + frame.height), inv) as any;

    const worldLeft = Math.min(p1.x, p2.x);
    const worldTop = Math.min(p1.y, p2.y);
    const worldRight = Math.max(p1.x, p2.x);
    const worldBottom = Math.max(p1.y, p2.y);

    const baseLeft = base.left;
    const baseTop = base.top;
    const baseRight = base.left + base.width;
    const baseBottom = base.top + base.height;

    const left = Math.max(baseLeft, worldLeft);
    const top = Math.max(baseTop, worldTop);
    const right = Math.min(baseRight, worldRight);
    const bottom = Math.min(baseBottom, worldBottom);
    const width = right - left;
    const height = bottom - top;
    if (width < 10 || height < 10) return null;
    return exportDataUrl({ left, top, width, height });
  };

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    cropPresetRef.current = cropPreset;
  }, [cropPreset]);

  useEffect(() => {
    blurPxRef.current = blurPx;
  }, [blurPx]);

  const exportMultiplier = () => {
    const c = canvasRef.current;
    const bg = bgRef.current;
    if (!c || !bg || typeof (bg as any).scaleX !== "number") return 1;
    const s = (bg as any).scaleX as number;
    const raw = 1 / Math.max(0.0001, s);
    return clamp(raw, 1, MAX_EXPORT_MULTIPLIER);
  };

  const updateHistoryFlags = () => {
    const h = historyRef.current;
    setCanUndo(h.undo.length > 1);
    setCanRedo(h.redo.length > 0);
  };

  const getBaseRect = () => {
    const c = canvasRef.current;
    const bg = bgRef.current;
    const nat = naturalRef.current;
    if (!c || !bg || !nat) return null;
    const sx = typeof (bg as any).scaleX === "number" ? ((bg as any).scaleX as number) : 1;
    const sy = typeof (bg as any).scaleY === "number" ? ((bg as any).scaleY as number) : sx;
    const w = nat.w * sx;
    const h = nat.h * sy;
    const left = (typeof (bg as any).left === "number" ? ((bg as any).left as number) : c.getWidth() / 2) - w / 2;
    const top = (typeof (bg as any).top === "number" ? ((bg as any).top as number) : c.getHeight() / 2) - h / 2;
    return { left, top, width: w, height: h };
  };

  const captureSnapshot = (overrides?: Partial<{ brightness: number; contrast: number; saturation: number }>) => {
    const c = canvasRef.current;
    const bg = bgRef.current;
    const nat = naturalRef.current;
    if (!c || !bg || !nat) return null;
    const vpt = c.viewportTransform ? [...c.viewportTransform] : [1, 0, 0, 1, 0, 0];
    const objects = c
      .getObjects()
      .filter(
        (o) =>
          o !== cropRectRef.current &&
          o !== blurRectRef.current &&
          o !== blurPreviewRef.current &&
          !(o as any).excludeFromExport
      )
      .map((o) => (o as any).toObject());
    return {
      baseSrc: bg.getSrc(false),
      natural: { ...nat },
      brightness: overrides?.brightness ?? brightness,
      contrast: overrides?.contrast ?? contrast,
      saturation: overrides?.saturation ?? saturation,
      objects,
      vpt,
    };
  };

  const pushSnapshot = (
    opts?: { force?: boolean; overrides?: Partial<{ brightness: number; contrast: number; saturation: number }> }
  ) => {
    if (!opts?.force && (busy || loading)) return;
    const snap = captureSnapshot(opts?.overrides);
    if (!snap) return;
    const h = historyRef.current;
    h.undo.push(snap);
    if (h.undo.length > 30) h.undo.shift();
    h.redo = [];
    updateHistoryFlags();
  };

  const restoreSnapshot = async (snap: {
    baseSrc: string;
    natural: { w: number; h: number };
    brightness: number;
    contrast: number;
    saturation: number;
    objects: any[];
    vpt: number[];
  }) => {
    const c = canvasRef.current;
    if (!c) return;
    setBusy(true);
    setError("");
    try {
      const currentBg = bgRef.current;
      const currentNat = naturalRef.current;
      const sameBase =
        !!currentBg &&
        !!currentNat &&
        currentBg.getSrc(false) === snap.baseSrc &&
        currentNat.w === snap.natural.w &&
        currentNat.h === snap.natural.h;

      if (!sameBase) {
        await setBaseFromDataUrl(snap.baseSrc, snap.natural);
      } else {
        // Only view/objects/filters changed — avoid reloading the image.
        setMode("move");
        clearCropSelection();
        clearBlurSelection();
        c.getObjects().forEach((o) => c.remove(o));
      }

      // Restore adjustments (non-destructive) and force a repaint immediately.
      setBrightness(snap.brightness);
      setContrast(snap.contrast);
      setSaturation(snap.saturation);
      ensureCanvas2dFilters();
      const bg = bgRef.current;
      if (bg) {
        // @ts-expect-error - fabric filter types are not strict in v4 typings
        const filters: any[] = [];
        const b = clamp(snap.brightness, -1, 1);
        const ct = clamp(snap.contrast, -1, 1);
        const s = clamp(snap.saturation, -1, 1);
        if (b !== 0) {
          // @ts-expect-error - filters namespace typing mismatch
          filters.push(new fabric.Image.filters.Brightness({ brightness: b }));
        }
        if (ct !== 0) {
          // @ts-expect-error - filters namespace typing mismatch
          filters.push(new fabric.Image.filters.Contrast({ contrast: ct }));
        }
        if (s !== 0) {
          // @ts-expect-error - filters namespace typing mismatch
          filters.push(new fabric.Image.filters.Saturation({ saturation: s }));
        }
        // @ts-expect-error - filters property typing mismatch
        bg.filters = filters;
        // @ts-expect-error - applyFilters typing mismatch
        bg.applyFilters();
      }

      // Restore drawn objects.
      if (snap.objects?.length) {
        await new Promise<void>((resolve) => {
          // @ts-expect-error - fabric util typings are loose in v4
          fabric.util.enlivenObjects(snap.objects, (objs: any[]) => {
            objs.forEach((o) => {
              o.set({ selectable: false, evented: false, objectCaching: false });
              c.add(o);
            });
            resolve();
          });
        });
      }

      c.setViewportTransform(snap.vpt as any);
      setZoom(Number(c.getZoom().toFixed(2)));
      c.requestRenderAll();
    } catch (e: any) {
      setError(e?.message || "Не удалось восстановить состояние");
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const h = historyRef.current;
    if (busy || loading) return;
    if (h.undo.length <= 1) return;
    const current = h.undo.pop();
    if (current) h.redo.push(current);
    updateHistoryFlags();
    const prev = h.undo[h.undo.length - 1];
    if (prev) await restoreSnapshot(prev);
  };

  const redo = async () => {
    const h = historyRef.current;
    if (busy || loading) return;
    const next = h.redo.pop();
    if (!next) return;
    h.undo.push(next);
    updateHistoryFlags();
    await restoreSnapshot(next);
  };

  const scheduleViewSnapshot = () => {
    if (viewSnapshotTimerRef.current) window.clearTimeout(viewSnapshotTimerRef.current);
    viewSnapshotTimerRef.current = window.setTimeout(() => {
      viewSnapshotTimerRef.current = null;
      pushSnapshot();
    }, 180);
  };

  const undoRef = useRef<() => void>(() => undefined);
  const redoRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    undoRef.current = () => void undo();
    redoRef.current = () => void redo();
  }, [undo, redo]);

  const resetViewport = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.setViewportTransform([1, 0, 0, 1, 0, 0]);
    c.setZoom(1);
    setZoom(1);
    c.requestRenderAll();
  };

  const resetView = () => {
    // "Reset view" is meant to reset only the viewer state (pan/zoom/temporary tools),
    // not the edited bitmap history.
    angleDraggingRef.current = false;
    setAngle(0);
    scheduleAnglePreview();

    setMode("move");
    clearCropSelection();
    clearBlurSelection();
    isPanningRef.current = false;
    lastPanRef.current = null;

    resetViewport();
    pushSnapshot();
  };

  const resizeToFit = () => {
    const container = containerRef.current;
    const c = canvasRef.current;
    const nat = naturalRef.current;
    const bg = bgRef.current;
    if (!container || !c || !nat || !bg) return;

    // Only resize safely when there are no overlay objects (to avoid misalignment).
    if (c.getObjects().length > 0) return;

    // Fit: canvas matches container size; image scales to fully fit inside.
    const w = Math.floor(Math.max(320, container.clientWidth));
    const h = Math.floor(Math.max(240, container.clientHeight));

    c.setWidth(w);
    c.setHeight(h);
    c.calcOffset();

    const scale = Math.min(w / nat.w, h / nat.h);
    bg.set({
      originX: "center",
      originY: "center",
      left: w / 2,
      top: h / 2,
      scaleX: scale,
      scaleY: scale,
      angle: 0,
    });

    resetViewport();
  };

  const applyFilters = () => {
    const c = canvasRef.current;
    const bg = bgRef.current;
    if (!c || !bg) return;

    ensureCanvas2dFilters();

    // @ts-expect-error - fabric filter types are not strict in v4 typings
    const filters: any[] = [];
    const b = clamp(brightness, -1, 1);
    const ct = clamp(contrast, -1, 1);
    const s = clamp(saturation, -1, 1);
    if (b !== 0) {
      // @ts-expect-error - filters namespace typing mismatch
      filters.push(new fabric.Image.filters.Brightness({ brightness: b }));
    }
    if (ct !== 0) {
      // @ts-expect-error - filters namespace typing mismatch
      filters.push(new fabric.Image.filters.Contrast({ contrast: ct }));
    }
    if (s !== 0) {
      // @ts-expect-error - filters namespace typing mismatch
      filters.push(new fabric.Image.filters.Saturation({ saturation: s }));
    }
    // @ts-expect-error - filters property typing mismatch
    bg.filters = filters;
    // applyFilters can be async in some builds; still safe to call and then render.
    // @ts-expect-error - applyFilters typing mismatch
    bg.applyFilters();
    c.requestRenderAll();
  };

  const scheduleApplyFilters = () => {
    if (filterRafRef.current) return;
    filterRafRef.current = window.requestAnimationFrame(() => {
      filterRafRef.current = null;
      applyFilters();
    });
  };

  // Live preview for filters while dragging range inputs (throttled by rAF).
  useEffect(() => {
    scheduleApplyFilters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brightness, contrast, saturation]);

  const clearBlurSelection = () => {
    const c = canvasRef.current;
    if (!c) return;
    if (blurPreviewRef.current) {
      c.remove(blurPreviewRef.current);
      blurPreviewRef.current = null;
    }
    if (blurRectRef.current) {
      c.remove(blurRectRef.current);
      blurRectRef.current = null;
    }
    setHasBlurSelection(false);
    c.requestRenderAll();
  };

  const clearCropSelection = () => {
    const c = canvasRef.current;
    if (!c) return;
    if (cropRectRef.current) {
      c.remove(cropRectRef.current);
      cropRectRef.current = null;
    }
    setHasCropSelection(false);
    c.requestRenderAll();
  };

  const scheduleAnglePreview = () => {
    if (anglePreviewRafRef.current) return;
    anglePreviewRafRef.current = window.requestAnimationFrame(() => {
      anglePreviewRafRef.current = null;
      const c = canvasRef.current;
      if (!c) return;
      const wrapper = (c as any).wrapperEl as HTMLElement | undefined;
      if (!wrapper) return;
      if (!angleDraggingRef.current || angle === 0) {
        wrapper.style.transform = "";
        wrapper.style.transformOrigin = "";
        return;
      }
      wrapper.style.transformOrigin = "50% 50%";
      wrapper.style.transform = `rotate(${angle}deg)`;
    });
  };

  // Live preview for angle while dragging the range input (avoid affecting Fabric pointer math).
  useEffect(() => {
    if (angleDraggingRef.current) scheduleAnglePreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [angle]);

  const scheduleBlurPreview = () => {
    if (blurPreviewRafRef.current) return;
    blurPreviewRafRef.current = window.requestAnimationFrame(() => {
      blurPreviewRafRef.current = null;
      if (blurPreviewBusyRef.current) {
        blurPreviewPendingRef.current = true;
        return;
      }
      const c = canvasRef.current;
      const rect = blurRectRef.current;
      if (!c || !rect || modeRef.current !== "blur") return;
      const bbox = rect.getBoundingRect();
      if (bbox.width < 10 || bbox.height < 10) return;

      blurPreviewBusyRef.current = true;
      try {
        // Render a snapshot with identity viewport for consistent coordinates.
        const vpt = c.viewportTransform ? [...c.viewportTransform] : [1, 0, 0, 1, 0, 0];
        c.setViewportTransform([1, 0, 0, 1, 0, 0]);

        const snapshot = c.toCanvasElement(1, {
          filter: (obj: any) =>
            obj !== cropRectRef.current &&
            obj !== blurRectRef.current &&
            obj !== blurPreviewRef.current,
        } as any);

        c.setViewportTransform(vpt as any);
        c.requestRenderAll();

        const patchW = Math.max(1, Math.round(bbox.width));
        const patchH = Math.max(1, Math.round(bbox.height));
        const patch = document.createElement("canvas");
        patch.width = patchW;
        patch.height = patchH;
        const pctx = patch.getContext("2d");
        if (!pctx) return;
        pctx.filter = `blur(${blurPxRef.current}px)`;
        pctx.drawImage(
          snapshot,
          bbox.left,
          bbox.top,
          bbox.width,
          bbox.height,
          0,
          0,
          patchW,
          patchH
        );

        if (blurPreviewRef.current) {
          c.remove(blurPreviewRef.current);
          blurPreviewRef.current = null;
        }

        const img = new fabric.Image(patch, {
          left: bbox.left,
          top: bbox.top,
          originX: "left",
          originY: "top",
          selectable: false,
          evented: false,
          objectCaching: false,
        });
        blurPreviewRef.current = img;
        c.add(img);
        c.bringToFront(rect);
        c.requestRenderAll();
      } finally {
        blurPreviewBusyRef.current = false;
        if (blurPreviewPendingRef.current) {
          blurPreviewPendingRef.current = false;
          scheduleBlurPreview();
        }
      }
    });
  };

  // Keep blur preview in sync while tweaking the slider (and while the rect exists).
  useEffect(() => {
    if (mode === "blur" && hasBlurSelection) scheduleBlurPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blurPx, mode, hasBlurSelection]);

  const setBaseFromDataUrl = async (dataUrl: string, nextNatural?: { w: number; h: number }) => {
    const c = canvasRef.current;
    if (!c) return;

    // Clear all drawn objects.
    c.getObjects().forEach((o) => c.remove(o));
    cropRectRef.current = null;
    blurRectRef.current = null;
    blurPreviewRef.current = null;
    setHasCropSelection(false);
    setHasBlurSelection(false);

    // Load new bitmap as background.
    const imgEl = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
      img.src = dataUrl;
    });

    naturalRef.current = nextNatural ?? { w: imgEl.naturalWidth || imgEl.width, h: imgEl.naturalHeight || imgEl.height };

    await new Promise<void>((resolve, reject) => {
      fabric.Image.fromURL(
        dataUrl,
        (img) => {
          if (!img) {
            reject(new Error("Не удалось открыть изображение"));
            return;
          }
          bgRef.current = img;
          c.setBackgroundImage(img, () => {
            resolve();
          });
        },
        { crossOrigin: "anonymous" }
      );
    });

    // Reset adjustments (they're now baked).
    setBrightness(0);
    setContrast(0);
    setSaturation(0);
    setAngle(0);
    setMode("move");

    resizeToFit();
    c.requestRenderAll();
  };

  const exportDataUrl = (options?: { left?: number; top?: number; width?: number; height?: number }) => {
    const c = canvasRef.current;
    if (!c) return null;
    const vpt = c.viewportTransform ? [...c.viewportTransform] : [1, 0, 0, 1, 0, 0];
    c.setViewportTransform([1, 0, 0, 1, 0, 0]);
    const multiplier = exportMultiplier();
    const base = getBaseRect();
    const dataUrl = c.toDataURL({
      format: "png",
      multiplier,
      left: options?.left ?? base?.left,
      top: options?.top ?? base?.top,
      width: options?.width ?? base?.width,
      height: options?.height ?? base?.height,
      filter: (obj) =>
        obj !== cropRectRef.current &&
        obj !== blurRectRef.current &&
        obj !== blurPreviewRef.current,
    });
    c.setViewportTransform(vpt as any);
    c.requestRenderAll();
    return { dataUrl, multiplier };
  };

  const applyCrop = async () => {
    const c = canvasRef.current;
    const rect = cropRectRef.current;
    if (!c || !rect) return;
    setBusy(true);
    setError("");
    try {
      c.remove(rect);
      cropRectRef.current = null;
      setHasCropSelection(false);
      const bbox = rect.getBoundingRect();
      const base = getBaseRect();
      const baseLeft = base?.left ?? 0;
      const baseTop = base?.top ?? 0;
      const baseRight = (base?.left ?? 0) + (base?.width ?? c.getWidth());
      const baseBottom = (base?.top ?? 0) + (base?.height ?? c.getHeight());

      const left = Math.max(baseLeft, bbox.left);
      const top = Math.max(baseTop, bbox.top);
      const right = Math.min(baseRight, bbox.left + bbox.width);
      const bottom = Math.min(baseBottom, bbox.top + bbox.height);
      const width = right - left;
      const height = bottom - top;
      if (width < 10 || height < 10) throw new Error("Слишком маленькая область кадрирования");
      const exp = exportDataUrl({ left, top, width, height });
      if (!exp) throw new Error("Не удалось экспортировать кадрирование");
      const nextNatural = {
        w: Math.max(1, Math.round(width * exp.multiplier)),
        h: Math.max(1, Math.round(height * exp.multiplier)),
      };
      await setBaseFromDataUrl(exp.dataUrl, nextNatural);
      pushSnapshot({ force: true, overrides: { brightness: 0, contrast: 0, saturation: 0 } });
    } catch (e: any) {
      setError(e?.message || "Не удалось применить кадрирование");
    } finally {
      setBusy(false);
    }
  };

  const applyBlur = async () => {
    const c = canvasRef.current;
    const rect = blurRectRef.current;
    if (!rect || !c) return;
    setBusy(true);
    setError("");
    try {
      const bbox = rect.getBoundingRect();
      const base = getBaseRect();
      if (!base) throw new Error("Не удалось определить область изображения");

      const left = Math.max(base.left, bbox.left);
      const top = Math.max(base.top, bbox.top);
      const right = Math.min(base.left + base.width, bbox.left + bbox.width);
      const bottom = Math.min(base.top + base.height, bbox.top + bbox.height);
      const width = right - left;
      const height = bottom - top;
      if (width < 10 || height < 10) throw new Error("Слишком маленькая область размытия");

      clearBlurSelection();
      const exp = exportDataUrl();
      if (!exp) throw new Error("Не удалось экспортировать изображение");
      const fullImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Не удалось загрузить изображение"));
        img.src = exp.dataUrl;
      });

      const pxLeft = Math.max(0, Math.round((left - base.left) * exp.multiplier));
      const pxTop = Math.max(0, Math.round((top - base.top) * exp.multiplier));
      const pxW = Math.max(1, Math.round(width * exp.multiplier));
      const pxH = Math.max(1, Math.round(height * exp.multiplier));

      const off = document.createElement("canvas");
      off.width = fullImg.naturalWidth || fullImg.width;
      off.height = fullImg.naturalHeight || fullImg.height;
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("Canvas недоступен");
      ctx.drawImage(fullImg, 0, 0);

      const tmp = document.createElement("canvas");
      tmp.width = pxW;
      tmp.height = pxH;
      const tctx = tmp.getContext("2d");
      if (!tctx) throw new Error("Canvas недоступен");
      tctx.filter = `blur(${Math.max(1, Math.round(blurPx * exp.multiplier))}px)`;
      tctx.drawImage(off, pxLeft, pxTop, pxW, pxH, 0, 0, pxW, pxH);

      ctx.drawImage(tmp, 0, 0, pxW, pxH, pxLeft, pxTop, pxW, pxH);

      const dataUrl = off.toDataURL("image/png");
      await setBaseFromDataUrl(dataUrl, { w: off.width, h: off.height });
      pushSnapshot({ force: true, overrides: { brightness: 0, contrast: 0, saturation: 0 } });
    } catch (e: any) {
      setError(e?.message || "Не удалось применить размытие");
    } finally {
      setBusy(false);
    }
  };

  const applyRotate = async (deg: number) => {
    setBusy(true);
    setError("");
    try {
      const exp = exportDataUrl();
      if (!exp) throw new Error("Не удалось экспортировать изображение");
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Не удалось загрузить изображение"));
        el.src = exp.dataUrl;
      });

      const rad = (deg * Math.PI) / 180;
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const sin = Math.abs(Math.sin(rad));
      const cos = Math.abs(Math.cos(rad));
      const newW = Math.max(1, Math.round(w * cos + h * sin));
      const newH = Math.max(1, Math.round(w * sin + h * cos));

      const off = document.createElement("canvas");
      off.width = newW;
      off.height = newH;
      const ctx = off.getContext("2d");
      if (!ctx) throw new Error("Canvas недоступен");
      ctx.translate(newW / 2, newH / 2);
      ctx.rotate(rad);
      ctx.drawImage(img, -w / 2, -h / 2);
      const dataUrl = off.toDataURL("image/png");
      await setBaseFromDataUrl(dataUrl, { w: newW, h: newH });
      pushSnapshot({ force: true, overrides: { brightness: 0, contrast: 0, saturation: 0 } });
    } catch (e: any) {
      setError(e?.message || "Не удалось повернуть изображение");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const exp = variant === "cropOnly" ? exportCropFrameDataUrl() : exportDataUrl();
      if (!exp) throw new Error("Не удалось экспортировать изображение");
      const blob = await (await fetch(exp.dataUrl)).blob();
      const safeBase = stripExt(fileName || "image");
      const nextName = `${safeBase}.png`;
      const file = new File([blob], nextName, { type: "image/png" });
      onSave(file);
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить изображение");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          redoRef.current();
        } else {
          undoRef.current();
        }
        return;
      }
      if (isMod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redoRef.current();
        return;
      }
      if (e.code === "Space") {
        spaceDownRef.current = true;
      }
      if (e.key === "Escape") onCancel();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDownRef.current = false;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [onCancel]);

  useEffect(() => {
    const el = canvasElRef.current;
    if (!el) return;

    const c = new fabric.Canvas(el, {
      backgroundColor: "rgba(255,255,255,0.03)",
      selection: false,
      preserveObjectStacking: true,
    });
    canvasRef.current = c;

    // Zoom with wheel
    c.on("mouse:wheel", (opt: any) => {
      const e = opt.e as WheelEvent;
      let z = c.getZoom();
      z *= 0.999 ** e.deltaY;
      const { min, max } = cropOnlyZoomBounds();
      z = clamp(z, min, max);
      c.zoomToPoint(new fabric.Point(e.offsetX, e.offsetY), z);
      setZoom(Number(z.toFixed(2)));
      cropUserInteractedRef.current = true;
      if (variant === "cropOnly" && modeRef.current === "crop") clampViewportToCoverFrame();
      scheduleViewSnapshot();
      e.preventDefault();
      e.stopPropagation();
    });

    // Panning (hold Space)
    c.on("mouse:down", (opt: any) => {
      const e = opt.e as MouseEvent;
      const currentMode = modeRef.current;
      if (spaceDownRef.current || (variant === "cropOnly" && currentMode === "crop")) {
        isPanningRef.current = true;
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        prevDrawingRef.current = c.isDrawingMode;
        c.isDrawingMode = false;
        cropUserInteractedRef.current = true;
        return;
      }
      if (currentMode !== "crop" && currentMode !== "blur") return;
      const pointer = c.getPointer(e);
      isDraggingRef.current = true;
      startRef.current = { x: pointer.x, y: pointer.y };

      const rect = new fabric.Rect({
        left: pointer.x,
        top: pointer.y,
        width: 0,
        height: 0,
        fill: currentMode === "blur" ? "rgba(0,0,0,0)" : "rgba(14,165,233,0.10)",
        stroke: "rgba(255,255,255,0.55)",
        strokeDashArray: [6, 6],
        strokeWidth: 1,
        selectable: false,
        evented: false,
        objectCaching: false,
      });
      if (currentMode === "crop") {
        setHasCropSelection(false);
        clearCropSelection();
        if (cropRectRef.current) c.remove(cropRectRef.current);
        cropRectRef.current = rect;
      } else {
        setHasBlurSelection(false);
        clearBlurSelection();
        if (blurRectRef.current) c.remove(blurRectRef.current);
        blurRectRef.current = rect;
      }
      c.add(rect);
      c.requestRenderAll();
    });

    c.on("mouse:move", (opt: any) => {
      const e = opt.e as MouseEvent;
      if (isPanningRef.current && lastPanRef.current) {
        const vpt = c.viewportTransform;
        if (!vpt) return;
        vpt[4] += e.clientX - lastPanRef.current.x;
        vpt[5] += e.clientY - lastPanRef.current.y;
        if (variant === "cropOnly" && modeRef.current === "crop") {
          clampViewportToCoverFrame(vpt as any);
        } else {
          c.requestRenderAll();
        }
        lastPanRef.current = { x: e.clientX, y: e.clientY };
        return;
      }
      if (!isDraggingRef.current || !startRef.current) return;
      const pointer = c.getPointer(e);
      const sx = startRef.current.x;
      const sy = startRef.current.y;
      let left = Math.min(sx, pointer.x);
      let top = Math.min(sy, pointer.y);
      let width = Math.abs(pointer.x - sx);
      let height = Math.abs(pointer.y - sy);

      const currentMode = modeRef.current;
      const ratio =
        currentMode === "crop" ? fixedCropRatio ?? cropRatioValue(cropPresetRef.current) : null;
      if (ratio && width > 1 && height > 1) {
        // Keep aspect ratio while dragging.
        const wFromH = height * ratio;
        const hFromW = width / ratio;
        if (wFromH < width) {
          width = wFromH;
        } else {
          height = hFromW;
        }
        // Recompute left/top based on drag direction.
        if (pointer.x < sx) left = sx - width;
        if (pointer.y < sy) top = sy - height;
      }

      const rect = currentMode === "crop" ? cropRectRef.current : blurRectRef.current;
      if (!rect) return;
      rect.set({ left, top, width, height });
      rect.setCoords();
      c.requestRenderAll();

      const valid = width >= 10 && height >= 10;
      if (currentMode === "crop") {
        setHasCropSelection(valid);
      } else {
        setHasBlurSelection(valid);
        if (valid) scheduleBlurPreview();
      }
    });

    c.on("mouse:up", () => {
      if (isPanningRef.current) {
        isPanningRef.current = false;
        lastPanRef.current = null;
        c.isDrawingMode = prevDrawingRef.current;
        if (variant === "cropOnly" && modeRef.current === "crop") clampViewportToCoverFrame();
        scheduleViewSnapshot();
        return;
      }
      isDraggingRef.current = false;
      startRef.current = null;
      if (modeRef.current === "crop") {
        const rect = cropRectRef.current;
        if (!rect) return;
        const bbox = rect.getBoundingRect();
        setHasCropSelection(bbox.width >= 10 && bbox.height >= 10);
        return;
      }
      if (modeRef.current === "blur") {
        const rect = blurRectRef.current;
        if (!rect) return;
        const bbox = rect.getBoundingRect();
        const valid = bbox.width >= 10 && bbox.height >= 10;
        setHasBlurSelection(valid);
        if (valid) scheduleBlurPreview();
      }
    });

    // Make drawn paths non-interactive.
    c.on("path:created", (opt: any) => {
      const path = opt?.path as fabric.Path | undefined;
      if (!path) return;
      path.set({ selectable: false, evented: false, objectCaching: false });
      pushSnapshot();
    });

    return () => {
      c.dispose();
      canvasRef.current = null;
      bgRef.current = null;
    };
    // We intentionally ignore mode/cropPreset here; handlers read latest via closures and state updates below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (mode !== "crop") clearCropSelection();
    if (mode !== "blur") clearBlurSelection();
  }, [mode]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.isDrawingMode = mode === "draw";
    if (c.isDrawingMode) {
      const brush = c.freeDrawingBrush;
      if (brush) {
        // @ts-expect-error - brush has color/width
        brush.color = brushColor;
        // @ts-expect-error - brush has color/width
        brush.width = brushSize;
      }
    }
    c.requestRenderAll();
  }, [mode, brushColor, brushSize]);

  useEffect(() => {
    let cancelled = false;
    const c = canvasRef.current;
    if (!c) return;

    setLoading(true);
    setError("");
    // Reset UI state for a new source.
    cropInitRef.current = false;
    cropUserInteractedRef.current = false;
    angleDraggingRef.current = false;
    setMode(effectiveInitialMode);
    setBrightness(0);
    setContrast(0);
    setSaturation(0);
    setAngle(0);
    setCropPreset(initialCropPreset);

    const imgEl = new Image();
    imgEl.onload = () => {
      if (cancelled) return;
      naturalRef.current = { w: imgEl.naturalWidth || imgEl.width, h: imgEl.naturalHeight || imgEl.height };
      fabric.Image.fromURL(
        src,
        (img) => {
          if (cancelled) return;
          if (!img) {
            setError("Не удалось открыть изображение");
            setLoading(false);
            return;
          }
          bgRef.current = img;
          c.setBackgroundImage(img, () => {
            resizeToFit();
            if (variant === "cropOnly") {
              // Frame depends on the actual canvas size after resizeToFit.
              const w = c.getWidth();
              const h = c.getHeight();
              const frame = computeFixedCropFrame(w, h);
                cropFrameRef.current = frame;
                setCropFrame(frame);
                setHasCropSelection(true);
                enforceCropOnlyZoomAndClamp();
              }
              setLoading(false);
              if (variant === "cropOnly") initCropOnlyView();

            // Init history with the very first view.
            historyRef.current.undo = [];
            historyRef.current.redo = [];
            const snap = captureSnapshot({ brightness: 0, contrast: 0, saturation: 0 });
            if (snap) historyRef.current.undo.push(snap);
            updateHistoryFlags();
          });
        },
        { crossOrigin: "anonymous" }
      );
    };
    imgEl.onerror = () => {
      if (cancelled) return;
      setError("Не удалось загрузить изображение");
      setLoading(false);
    };
    imgEl.src = src;

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    // Keep canvas sized to container while editing (but only when there are no drawn objects).
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => {
      resizeToFit();
      const c = canvasRef.current;
      if (!c) return;
      if (variant === "cropOnly") {
        const w = c.getWidth();
        const h = c.getHeight();
        const frame = computeFixedCropFrame(w, h);
        cropFrameRef.current = frame;
        setCropFrame(frame);
        setHasCropSelection(true);
        enforceCropOnlyZoomAndClamp();
        // If the user already interacted, keep their zoom; otherwise align nicely.
        if (!loading && !cropUserInteractedRef.current) initCropOnlyView();
        if (modeRef.current === "crop") clampViewportToCoverFrame();
      }
    });
    obs.observe(container);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, fixedCropRatio, cropMask, loading]);

  const topHint = useMemo(() => {
    if (mode === "move") return "Zoom: колесо мыши. Pan: удерживайте Space и тяните.";
    if (mode === "draw") return "Рисование: выберите цвет/размер кисти.";
    if (mode === "crop") {
      if (variant === "cropOnly") return "Перемещайте изображение под рамкой. Zoom: колесо мыши или кнопки.";
      return "Выделите область. Примените кадрирование.";
    }
    if (mode === "blur") return "Выделите область. Примените размытие.";
    return "";
  }, [mode, variant]);

  return (
    <div className="flex flex-col w-full h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="space-y-0.5">
          <p className="text-white font-semibold text-sm">{title}</p>
          <p className="text-white/50 text-xs">{topHint}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="px-3 py-1.5 rounded-full border border-white/20 text-white/80 hover:text-white hover:border-white/40 text-sm disabled:opacity-60"
            onClick={onCancel}
            disabled={busy}
          >
            Отмена
          </button>
          <button
            type="button"
            className="px-3 py-1.5 rounded-full bg-white text-black hover:bg-gray-200 text-sm font-semibold flex items-center gap-2 disabled:opacity-60"
            onClick={save}
            disabled={busy || loading}
          >
            <Save className="w-4 h-4" strokeWidth={2} />
            Сохранить
          </button>
          <button
            type="button"
            className="text-white/60 hover:text-white ml-1"
            onClick={onCancel}
            title="Закрыть"
            disabled={busy}
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-2">
        {variant === "full" ? (
          <>
            <button
              type="button"
              onClick={() => setMode("move")}
              className={`nav-icon border transition ${
                mode === "move"
                  ? "bg-white text-black border-white/60"
                  : "bg-white/5 text-white/70 border-white/10 hover:border-white/25 hover:bg-white/10"
              }`}
              title="Move / Pan"
            >
              <Move className="w-5 h-5" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              onClick={() => setMode("draw")}
              className={`nav-icon border transition ${
                mode === "draw"
                  ? "bg-white text-black border-white/60"
                  : "bg-white/5 text-white/70 border-white/10 hover:border-white/25 hover:bg-white/10"
              }`}
              title="Draw"
            >
              <Paintbrush className="w-5 h-5" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              onClick={() => setMode("crop")}
              className={`nav-icon border transition ${
                mode === "crop"
                  ? "bg-white text-black border-white/60"
                  : "bg-white/5 text-white/70 border-white/10 hover:border-white/25 hover:bg-white/10"
              }`}
              title="Crop"
            >
              <Crop className="w-5 h-5" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              onClick={() => setMode("blur")}
              className={`nav-icon border transition ${
                mode === "blur"
                  ? "bg-white text-black border-white/60"
                  : "bg-white/5 text-white/70 border-white/10 hover:border-white/25 hover:bg-white/10"
              }`}
              title="Blur"
            >
              <Droplets className="w-5 h-5" strokeWidth={1.7} />
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-white/60 text-sm">
            <Crop className="w-5 h-5" strokeWidth={1.7} />
            Кадрирование
          </div>
        )}

        {variant === "full" && <div className="h-8 w-px bg-white/10 mx-1" />}

        {variant === "full" && (
          <>
            <button
              type="button"
              className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25 disabled:opacity-60"
              title="Undo"
              onClick={() => void undo()}
              disabled={busy || loading || !canUndo}
            >
              <Undo2 className="w-5 h-5" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25 disabled:opacity-60"
              title="Redo"
              onClick={() => void redo()}
              disabled={busy || loading || !canRedo}
            >
              <Redo2 className="w-5 h-5" strokeWidth={1.7} />
            </button>
          </>
        )}

        {variant === "full" && <div className="h-8 w-px bg-white/10 mx-1" />}

        {variant === "full" && (
          <>
            <button
              type="button"
              className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25"
              title="Rotate left 90"
              onClick={() => applyRotate(-90)}
              disabled={busy || loading}
            >
              <RotateCcw className="w-5 h-5" strokeWidth={1.7} />
            </button>
            <button
              type="button"
              className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25"
              title="Rotate right 90"
              onClick={() => applyRotate(90)}
              disabled={busy || loading}
            >
              <RotateCw className="w-5 h-5" strokeWidth={1.7} />
            </button>
          </>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <button
            type="button"
            className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25"
            title="Zoom out"
            onClick={() => {
              const c = canvasRef.current;
              if (!c) return;
              const { min, max } = cropOnlyZoomBounds();
              const next = clamp(c.getZoom() * 0.9, min, max);
              c.zoomToPoint(new fabric.Point(c.getWidth() / 2, c.getHeight() / 2), next);
              setZoom(Number(next.toFixed(2)));
              c.requestRenderAll();
              cropUserInteractedRef.current = true;
              if (variant === "cropOnly" && modeRef.current === "crop") clampViewportToCoverFrame();
              scheduleViewSnapshot();
            }}
            disabled={loading}
          >
            <ZoomOut className="w-5 h-5" strokeWidth={1.7} />
          </button>
          <span className="text-white/60 text-sm w-14 text-center">{Math.round(zoom * 100)}%</span>
          <button
            type="button"
            className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25"
            title="Zoom in"
            onClick={() => {
              const c = canvasRef.current;
              if (!c) return;
              const { min, max } = cropOnlyZoomBounds();
              const next = clamp(c.getZoom() * 1.1, min, max);
              c.zoomToPoint(new fabric.Point(c.getWidth() / 2, c.getHeight() / 2), next);
              setZoom(Number(next.toFixed(2)));
              c.requestRenderAll();
              cropUserInteractedRef.current = true;
              if (variant === "cropOnly" && modeRef.current === "crop") clampViewportToCoverFrame();
              scheduleViewSnapshot();
            }}
            disabled={loading}
          >
            <ZoomIn className="w-5 h-5" strokeWidth={1.7} />
          </button>
        </div>
      </div>

      {(mode === "draw" || mode === "crop" || mode === "blur") && (
        <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center gap-4">
          {variant === "full" && mode === "draw" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-white/50 text-xs">Размер</span>
                <div className="flex items-center gap-2">
                  {BRUSH_SIZES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setBrushSize(s)}
                      className={`w-9 h-9 rounded-full border grid place-items-center transition ${
                        brushSize === s
                          ? "border-white/40 bg-white/10"
                          : "border-white/10 bg-white/5 hover:border-white/25"
                      }`}
                      title={`${s}px`}
                    >
                      <span
                        className="rounded-full bg-white/80"
                        style={{ width: Math.max(4, Math.min(18, s)), height: Math.max(4, Math.min(18, s)) }}
                      />
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-white/50 text-xs">Цвет</span>
                <div className="flex items-center gap-2 flex-wrap">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setBrushColor(c)}
                      className={`w-9 h-9 rounded-full border transition ${
                        brushColor.toLowerCase() === c.toLowerCase()
                          ? "border-white/40"
                          : "border-white/10 hover:border-white/25"
                      }`}
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    className="w-9 h-9 p-0 rounded-full border border-white/10 bg-white/5 overflow-hidden cursor-pointer"
                    title="Выбрать цвет"
                  />
                </div>
              </div>
            </>
          )}

          {mode === "crop" && (
            <>
              {!fixedCropRatio && variant === "full" ? (
                <div className="flex items-center gap-2">
                  <span className="text-white/50 text-xs">Пресет</span>
                  <div className="flex items-center gap-2">
                    {(["free", "1:1", "4:3", "16:9"] as CropPreset[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setCropPreset(p)}
                        className={`px-3 py-1.5 rounded-full border text-sm transition ${
                          cropPreset === p
                            ? "border-white/40 bg-white/10 text-white"
                            : "border-white/10 bg-white/5 text-white/70 hover:border-white/25 hover:text-white"
                        }`}
                      >
                        {p === "free" ? "Free" : p}
                      </button>
                    ))}
                  </div>
                </div>
              ) : fixedCropRatio ? (
                <div className="text-white/60 text-sm">
                  Формат: {Number(fixedCropRatio.toFixed(3))} : 1
                </div>
              ) : null}
              {variant === "full" && (
                <button
                  type="button"
                  className="ml-auto px-4 py-2 rounded-full bg-white text-black hover:bg-gray-200 font-semibold disabled:opacity-60"
                  onClick={applyCrop}
                  disabled={busy || loading || !hasCropSelection}
                >
                  Применить кадрирование
                </button>
              )}
            </>
          )}

          {variant === "full" && mode === "blur" && (
            <>
              <div className="flex items-center gap-2">
                <span className="text-white/50 text-xs">Blur</span>
                <input
                  type="range"
                  min={2}
                  max={20}
                  step={1}
                  value={blurPx}
                  onChange={(e) => setBlurPx(Number(e.target.value))}
                />
                <span className="text-white/60 text-sm w-10 text-right">{blurPx}px</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  className="px-4 py-2 rounded-full border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-60"
                  onClick={clearBlurSelection}
                  disabled={busy || loading || !hasBlurSelection}
                >
                  Отменить
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-full bg-white text-black hover:bg-gray-200 font-semibold disabled:opacity-60"
                  onClick={applyBlur}
                  disabled={busy || loading || !hasBlurSelection}
                >
                  Применить размытие
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {variant === "full" && (
        <div className="px-4 py-3 border-b border-white/10 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-1">
            <p className="text-white/60 text-xs">Brightness</p>
            <input
              type="range"
              min={-100}
              max={100}
              value={Math.round(brightness * 100)}
              onChange={(e) => setBrightness(Number(e.target.value) / 100)}
              onPointerUp={() => pushSnapshot()}
              onPointerCancel={() => pushSnapshot()}
            />
          </div>
          <div className="space-y-1">
            <p className="text-white/60 text-xs">Contrast</p>
            <input
              type="range"
              min={-100}
              max={100}
              value={Math.round(contrast * 100)}
              onChange={(e) => setContrast(Number(e.target.value) / 100)}
              onPointerUp={() => pushSnapshot()}
              onPointerCancel={() => pushSnapshot()}
            />
          </div>
          <div className="space-y-1">
            <p className="text-white/60 text-xs">Saturation</p>
            <input
              type="range"
              min={-100}
              max={100}
              value={Math.round(saturation * 100)}
              onChange={(e) => setSaturation(Number(e.target.value) / 100)}
              onPointerUp={() => pushSnapshot()}
              onPointerCancel={() => pushSnapshot()}
            />
          </div>

          <div className="md:col-span-3 flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs">Угол</span>
              <input
                type="range"
                min={-180}
                max={180}
                step={1}
                value={angle}
                onChange={(e) => setAngle(Number(e.target.value))}
                onPointerDown={() => {
                  angleDraggingRef.current = true;
                  scheduleAnglePreview();
                }}
                onPointerUp={async () => {
                  if (busy || loading) {
                    angleDraggingRef.current = false;
                    scheduleAnglePreview();
                    return;
                  }
                  if (angle === 0) {
                    angleDraggingRef.current = false;
                    scheduleAnglePreview();
                    return;
                  }
                  try {
                    // Keep the CSS preview while we bake rotation into the bitmap.
                    angleDraggingRef.current = true;
                    await applyRotate(angle);
                  } finally {
                    angleDraggingRef.current = false;
                    scheduleAnglePreview();
                    setAngle(0);
                  }
                }}
                onPointerCancel={() => {
                  angleDraggingRef.current = false;
                  scheduleAnglePreview();
                  setAngle(0);
                }}
              />
              <span className="text-white/60 text-sm w-12 text-right">{angle}°</span>
            </div>
            <button
              type="button"
              className="ml-auto px-4 py-2 rounded-full border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-60"
              onClick={resetView}
              disabled={loading || busy}
            >
              Сброс вида
            </button>
          </div>
        </div>
      )}

      <div className="p-4 flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="w-full h-full min-h-[320px] md:min-h-[420px] rounded-2xl border border-white/10 bg-black/20 overflow-hidden relative"
        >
          <canvas ref={canvasElRef} className="block w-full h-full" />
          {mode === "crop" && variant === "cropOnly" && cropFrame && (
            <div className="absolute inset-0 pointer-events-none">
              <div
                className={`absolute border border-white/30 shadow-[0_0_0_2000px_rgba(0,0,0,0.25)] ${
                  cropMask === "circle" ? "rounded-full" : "rounded-xl"
                }`}
                style={{
                  left: cropFrame.left,
                  top: cropFrame.top,
                  width: cropFrame.width,
                  height: cropFrame.height,
                }}
              />
            </div>
          )}
          {cropMask === "circle" && mode === "crop" && variant !== "cropOnly" && (
            <div className="absolute inset-0 pointer-events-none grid place-items-center">
              <div className="w-[70%] max-w-[360px] aspect-square rounded-full border border-white/30 shadow-[0_0_0_2000px_rgba(0,0,0,0.25)]" />
            </div>
          )}
        </div>
        {loading && <p className="mt-3 text-white/60 text-sm">Загрузка редактора...</p>}
        {error && <p className="mt-3 text-red-300 text-sm">{error}</p>}
      </div>
    </div>
  );
}

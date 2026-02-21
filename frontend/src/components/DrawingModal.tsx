import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  X,
  Paintbrush,
  Eraser,
  Minus,
  Square,
  Circle,
  Undo2,
  Redo2,
  Trash2,
} from "lucide-react";
import { useI18n } from "../i18n";

type Tool = "brush" | "eraser" | "line" | "rect" | "circle";

type Props = {
  onClose: () => void;
  onSave: (file: File) => void;
  title?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  canvasContainerClassName?: string;
  canvasContainerStyle?: CSSProperties;
  canvasClassName?: string;
};

const SIZES = [3, 6, 10, 16];
const COLORS = ["#111827", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#f59e0b", "#0ea5e9", "#000000", "#ffffff"];
const MAX_HISTORY = 40;

function clampHistory<T>(arr: T[]) {
  if (arr.length <= MAX_HISTORY) return arr;
  return arr.slice(arr.length - MAX_HISTORY);
}

export function DrawingModal({
  onClose,
  onSave,
  title,
  canvasWidth = 960,
  canvasHeight = 540,
  canvasContainerClassName = "",
  canvasContainerStyle,
  canvasClassName = "w-full h-[328px] md:h-[428px] rounded-xl touch-none select-none",
}: Props) {
  const { pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const modalTitle = title || tr("Сурет салу", "Рисование", "Drawing");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [tool, setTool] = useState<Tool>("brush");
  const [size, setSize] = useState<number>(SIZES[1]);
  const [color, setColor] = useState<string>(COLORS[0]);
  const [error, setError] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const historyRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);
  const drawingRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const snapshotRef = useRef<ImageData | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  const bg = "#ffffff";

  const getCtx = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d");
  };

  const fillBackground = () => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  };

  const pushHistory = () => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    try {
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      historyRef.current = clampHistory([...historyRef.current, img]);
      redoRef.current = [];
    } catch {
      // ignore history failures
    }
  };

  const restore = (img: ImageData) => {
    const ctx = getCtx();
    if (!ctx) return;
    try {
      ctx.putImageData(img, 0, 0);
    } catch {
      // ignore restore failures
    }
  };

  const undo = () => {
    const h = historyRef.current;
    if (h.length <= 1) return;
    const last = h[h.length - 1];
    redoRef.current = clampHistory([...redoRef.current, last]);
    historyRef.current = h.slice(0, -1);
    const prev = historyRef.current[historyRef.current.length - 1];
    restore(prev);
  };

  const redo = () => {
    const r = redoRef.current;
    if (r.length === 0) return;
    const next = r[r.length - 1];
    redoRef.current = r.slice(0, -1);
    historyRef.current = clampHistory([...historyRef.current, next]);
    restore(next);
  };

  const clear = () => {
    fillBackground();
    pushHistory();
  };

  const toCanvasPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const applyStrokeStyle = (ctx: CanvasRenderingContext2D, mode: Tool) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = size;
    if (mode === "eraser") {
      ctx.strokeStyle = bg;
    } else {
      ctx.strokeStyle = color;
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Keep a stable resolution that is good enough for posts while staying fast for undo.
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    fillBackground();
    historyRef.current = [];
    redoRef.current = [];
    pushHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      if (e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
      } else if (e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const toolLabel = useMemo(() => {
    switch (tool) {
      case "brush":
        return tr("Қылқалам", "Кисть", "Brush");
      case "eraser":
        return tr("Өшіргіш", "Ластик", "Eraser");
      case "line":
        return tr("Сызық", "Линия", "Line");
      case "rect":
        return tr("Тікбұрыш", "Прямоугольник", "Rectangle");
      case "circle":
        return tr("Шеңбер", "Круг", "Circle");
      default:
        return tr("Құрал", "Инструмент", "Tool");
    }
  }, [tool, tr]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;
    setError("");

    drawingRef.current = true;
    canvas.setPointerCapture(e.pointerId);

    const p = toCanvasPoint(e);
    startRef.current = p;
    lastRef.current = p;
    snapshotRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);

    if (tool === "brush" || tool === "eraser") {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      applyStrokeStyle(ctx, tool);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = getCtx();
    if (!canvas || !ctx) return;

    const p = toCanvasPoint(e);

    if (tool === "brush" || tool === "eraser") {
      applyStrokeStyle(ctx, tool);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      lastRef.current = p;
      return;
    }

    const start = startRef.current;
    const snap = snapshotRef.current;
    if (!start || !snap) return;
    restore(snap);
    applyStrokeStyle(ctx, tool);

    if (tool === "line") {
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (tool === "rect") {
      const w = p.x - start.x;
      const h = p.y - start.y;
      ctx.strokeRect(start.x, start.y, w, h);
    } else if (tool === "circle") {
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      const r = Math.sqrt(dx * dx + dy * dy);
      ctx.beginPath();
      ctx.arc(start.x, start.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  };

  const endStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    startRef.current = null;
    lastRef.current = null;
    snapshotRef.current = null;
    pushHistory();
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || saving) return;
    setSaving(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/png")
      );
      if (!blob) {
        setError(tr("Суретті сақтау мүмкін болмады", "Не удалось сохранить рисунок", "Failed to save drawing"));
        return;
      }
      const name = `drawing-${Date.now()}.png`;
      const file = new File([blob], name, { type: "image/png" });
      onSave(file);
    } catch {
      setError(tr("Суретті сақтау мүмкін болмады", "Не удалось сохранить рисунок", "Failed to save drawing"));
    } finally {
      setSaving(false);
    }
  };

  const ToolButton = ({
    t,
    children,
    title,
  }: {
    t: Tool;
    children: JSX.Element;
    title: string;
  }) => (
    <button
      type="button"
      title={title}
      onClick={() => setTool(t)}
      className={`nav-icon border transition ${
        tool === t
          ? "bg-white text-black border-white/60"
          : "bg-white/5 text-white/70 border-white/10 hover:border-white/25 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="relative bg-black border border-white/10 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="space-y-0.5">
            <p className="text-white font-semibold">{modalTitle}</p>
            <p className="text-white/50 text-xs">{toolLabel}</p>
          </div>
          <button type="button" onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <ToolButton t="brush" title={tr("Қылқалам", "Кисть", "Brush")}>
              <Paintbrush className="w-5 h-5" strokeWidth={1.7} />
            </ToolButton>
            <ToolButton t="eraser" title={tr("Өшіргіш", "Ластик", "Eraser")}>
              <Eraser className="w-5 h-5" strokeWidth={1.7} />
            </ToolButton>
            <ToolButton t="line" title={tr("Сызық", "Линия", "Line")}>
              <Minus className="w-5 h-5" strokeWidth={1.7} />
            </ToolButton>
            <ToolButton t="rect" title={tr("Тікбұрыш", "Прямоугольник", "Rectangle")}>
              <Square className="w-5 h-5" strokeWidth={1.7} />
            </ToolButton>
            <ToolButton t="circle" title={tr("Шеңбер", "Круг", "Circle")}>
              <Circle className="w-5 h-5" strokeWidth={1.7} />
            </ToolButton>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                title="Undo (Ctrl+Z)"
                onClick={undo}
                className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25"
              >
                <Undo2 className="w-5 h-5" strokeWidth={1.7} />
              </button>
              <button
                type="button"
                title="Redo (Ctrl+Y)"
                onClick={redo}
                className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25"
              >
                <Redo2 className="w-5 h-5" strokeWidth={1.7} />
              </button>
              <button
                type="button"
                title={tr("Тазарту", "Очистить", "Clear")}
                onClick={clear}
                className="nav-icon bg-white/5 border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/25"
              >
                <Trash2 className="w-5 h-5" strokeWidth={1.7} />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-white/50 text-xs">{tr("Өлшем", "Размер", "Size")}</span>
              <div className="flex items-center gap-2">
                {SIZES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    title={`${s}px`}
                    onClick={() => setSize(s)}
                    className={`w-9 h-9 rounded-full border grid place-items-center transition ${
                      size === s
                        ? "border-white/40 bg-white/10"
                        : "border-white/10 bg-white/5 hover:border-white/25"
                    }`}
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
              <span className="text-white/50 text-xs">{tr("Түс", "Цвет", "Color")}</span>
              <div className="flex items-center gap-2 flex-wrap">
                {COLORS.slice(0, 7).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-9 h-9 rounded-full border transition ${
                      color.toLowerCase() === c.toLowerCase()
                        ? "border-white/40"
                        : "border-white/10 hover:border-white/25"
                    }`}
                    style={{ backgroundColor: c }}
                    title={c}
                  />
                ))}
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-9 h-9 p-0 rounded-full border border-white/10 bg-white/5 overflow-hidden cursor-pointer"
                  title={tr("Түсті таңдау", "Выбрать цвет", "Pick color")}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-3 pb-3 flex-1 overflow-hidden">
          <div className={canvasContainerClassName} style={canvasContainerStyle}>
            <canvas
              ref={canvasRef}
              className={canvasClassName}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
            />
          </div>
        </div>

        <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between">
          <div className="text-white/60 text-xs">
            Undo: Ctrl+Z, Redo: Ctrl+Y
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-full border border-white/10 text-white/80 hover:bg-white/5"
              onClick={onClose}
              disabled={saving}
            >
              {tr("Бас тарту", "Отмена", "Cancel")}
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-full bg-white text-black hover:bg-gray-200 font-semibold disabled:opacity-60"
              onClick={save}
              disabled={saving}
            >
              {saving ? tr("Сақталуда...", "Сохраняем...", "Saving...") : tr("Сақтау", "Сохранить", "Save")}
            </button>
          </div>
        </div>

        {error && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2">
            <div className="rounded-full border border-white/10 bg-black/90 backdrop-blur px-4 py-2 text-sm text-red-300 shadow-2xl">
              {error}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

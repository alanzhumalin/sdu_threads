import { RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";

type EmojiGroup = {
  key: "faces" | "gestures" | "objects";
  items: string[];
};

type Props = {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (emoji: string) => void;
};

type PickerPosition = {
  top: number;
  left: number;
  width: number;
  listMaxHeight: number;
};

const DESKTOP_WIDTH = 320;
const VIEWPORT_GAP = 8;
const ESTIMATED_TOTAL_HEIGHT = 338;

const EMOJI_GROUPS: EmojiGroup[] = [
  {
    key: "faces",
    items: [
      "😀",
      "😁",
      "😂",
      "🤣",
      "😊",
      "😍",
      "🥰",
      "😎",
      "🤗",
      "🤔",
      "😴",
      "🤯",
      "🥳",
      "😇",
      "🙃",
      "😌",
      "😬",
      "😅",
      "🤩",
      "😭",
    ],
  },
  {
    key: "gestures",
    items: [
      "👍",
      "👎",
      "👏",
      "🙌",
      "🙏",
      "🤝",
      "💪",
      "✌️",
      "🤞",
      "👌",
      "👀",
      "🤍",
      "❤️",
      "🔥",
      "💯",
      "✨",
      "🎉",
      "🎯",
      "✅",
      "⚡",
    ],
  },
  {
    key: "objects",
    items: [
      "📌",
      "📣",
      "📸",
      "🎵",
      "🎬",
      "🧠",
      "💡",
      "🛠️",
      "🧩",
      "📱",
      "💻",
      "⌚",
      "🎁",
      "🏆",
      "🌍",
      "☀️",
      "🌙",
      "⭐",
      "🌈",
      "❗",
    ],
  },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getPickerPosition = (anchorRect: DOMRect): PickerPosition => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width =
    viewportWidth < 640
      ? Math.max(180, Math.min(DESKTOP_WIDTH, viewportWidth - VIEWPORT_GAP * 2))
      : DESKTOP_WIDTH;
  const left = clamp(
    anchorRect.right - width,
    VIEWPORT_GAP,
    Math.max(VIEWPORT_GAP, viewportWidth - width - VIEWPORT_GAP)
  );
  const availableHeight = Math.max(220, viewportHeight - VIEWPORT_GAP * 2);
  const spaceBelow = viewportHeight - anchorRect.bottom;
  const spaceAbove = anchorRect.top;
  const placeAbove = spaceBelow < 220 && spaceAbove > spaceBelow;
  const top = placeAbove
    ? Math.max(VIEWPORT_GAP, anchorRect.top - ESTIMATED_TOTAL_HEIGHT - 8)
    : clamp(anchorRect.bottom + 8, VIEWPORT_GAP, Math.max(VIEWPORT_GAP, viewportHeight - 220));
  const listMaxHeight = Math.max(160, Math.min(292, availableHeight - 64));

  return { top, left, width, listMaxHeight };
};

export function EmojiPicker({ open, anchorRef, onClose, onSelect }: Props) {
  const { pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PickerPosition | null>(null);
  const groupLabel = (key: EmojiGroup["key"]) => {
    if (key === "faces") return tr("Жүздер", "Лица", "Faces");
    if (key === "gestures") return tr("Жесттер", "Жесты и реакции", "Gestures");
    return tr("Нысандар", "Объекты", "Objects");
  };

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      setPosition(getPickerPosition(anchor.getBoundingClientRect()));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [anchorRef, onClose, open]);

  if (!open || !position) return null;

  return createPortal(
    <div
      ref={panelRef}
      className="z-[1100] overflow-hidden rounded-2xl border border-white/15 bg-[#0f1116] shadow-[0_22px_44px_rgba(0,0,0,0.55)]"
      style={{
        position: "fixed",
        top: position.top,
        left: position.left,
        width: position.width,
      }}
      role="dialog"
      aria-label={tr("Эмодзи таңдау", "Выбор эмодзи", "Emoji picker")}
    >
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-sm font-semibold text-white/85">{tr("Эмодзи", "Эмодзи", "Emoji")}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/15 px-2 py-0.5 text-xs text-white/60 hover:text-white hover:border-white/30"
          aria-label={tr("Эмодзи тізімін жабу", "Закрыть список эмодзи", "Close emoji list")}
        >
          {tr("Жабу", "Закрыть", "Close")}
        </button>
      </div>
      <div className="space-y-3 overflow-y-auto px-3 py-3 scrollbar-hide" style={{ maxHeight: position.listMaxHeight }}>
        {EMOJI_GROUPS.map((group) => (
          <section key={group.key} className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-white/45">{groupLabel(group.key)}</p>
            <div className="grid grid-cols-7 gap-1.5 sm:grid-cols-8">
              {group.items.map((emoji) => (
                <button
                  type="button"
                  key={`${group.key}-${emoji}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onSelect(emoji)}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-black/25 text-[20px] leading-none transition hover:border-white/25 hover:bg-white/10 sm:h-10 sm:w-10"
                  aria-label={tr(`Қою ${emoji}`, `Вставить ${emoji}`, `Insert ${emoji}`)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>,
    document.body
  );
}

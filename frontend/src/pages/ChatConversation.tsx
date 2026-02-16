import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Droplets,
  Heart,
  Leaf,
  Loader2,
  MoonStar,
  MoreVertical,
  Paperclip,
  Reply,
  SendHorizontal,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { api, type ChatMessage, type ChatMessageAttachment, type ChatPreview } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";
import { MediaViewerModal } from "../components/MediaViewerModal";
import { VerifiedBadge } from "../components/VerifiedBadge";

type UiMessage = ChatMessage & {
  pending?: boolean;
  failed?: boolean;
};

type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "uploaded" | "error";
  uploaded?: ChatMessageAttachment;
  error?: string;
};

type ReplyDraft = {
  id: string;
  sender_id: string;
  body: string;
};

type ChatSocketEvent =
  | { type: "ready"; chat_id: string }
  | { type: "message_created"; chat_id: string; message: ChatMessage }
  | { type: "message.created"; chat_id: string; message: ChatMessage }
  | { type: "messages_read"; chat_id: string; user_id: string; message_ids: string[]; read_at?: string }
  | { type: "chat_typing"; chat_id: string; user_id: string; is_typing: boolean }
  | { type: "chat_theme_updated"; chat_id: string; theme_key: string }
  | { type: "chat_presence_updated"; chat_id: string; user_id: string; is_online: boolean; last_seen_at?: string }
  | { type: "error"; message: string };

type ChatThemeKey = "default" | "love" | "nature" | "sunset" | "ocean" | "midnight";

type ChatThemeConfig = {
  label: string;
  description: string;
  listClass: string;
  headerOverlayClass: string;
  mineBubbleClass: string;
  mineReplyButtonClass: string;
  chipClass: string;
  icon: LucideIcon;
  iconClass: string;
  decorClass: string;
  decorAltIcon: LucideIcon;
  glowClass: string;
};

const CHAT_THEME_ORDER: ChatThemeKey[] = ["default", "love", "nature", "sunset", "ocean", "midnight"];

const CHAT_THEMES: Record<ChatThemeKey, ChatThemeConfig> = {
  default: {
    label: "Классика",
    description: "Минималистичный стиль со спокойным свечением",
    listClass: "",
    headerOverlayClass:
      "bg-[radial-gradient(circle_at_12%_18%,rgba(255,255,255,0.06),transparent_45%),linear-gradient(to_right,rgba(255,255,255,0.03),transparent_60%)]",
    mineBubbleClass: "bg-[#1f5fbf] text-white",
    mineReplyButtonClass: "border-sky-500/40 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35",
    chipClass: "bg-white/10 text-white/80 border-white/15",
    icon: Sparkles,
    iconClass: "text-white/75",
    decorClass: "text-white/10",
    decorAltIcon: Sparkles,
    glowClass: "bg-white/10",
  },
  love: {
    label: "Love",
    description: "Романтичные сердечки и мягкие розовые акценты",
    listClass: "bg-gradient-to-b from-rose-500/15 via-pink-500/10 to-transparent",
    headerOverlayClass:
      "bg-[radial-gradient(circle_at_18%_22%,rgba(244,63,94,0.24),transparent_48%),linear-gradient(to_right,rgba(236,72,153,0.16),rgba(255,255,255,0.02)_70%)]",
    mineBubbleClass: "bg-rose-600 text-white",
    mineReplyButtonClass: "border-rose-300/35 bg-rose-500/30 text-rose-100 hover:bg-rose-500/45",
    chipClass: "bg-rose-500/20 text-rose-100 border-rose-300/35",
    icon: Heart,
    iconClass: "text-rose-300",
    decorClass: "text-rose-200/20",
    decorAltIcon: Sparkles,
    glowClass: "bg-rose-500/25",
  },
  nature: {
    label: "Nature",
    description: "Листья и свежий зеленый фон в спокойном тоне",
    listClass: "bg-gradient-to-b from-emerald-500/15 via-green-500/10 to-transparent",
    headerOverlayClass:
      "bg-[radial-gradient(circle_at_18%_18%,rgba(16,185,129,0.22),transparent_46%),linear-gradient(to_right,rgba(34,197,94,0.16),rgba(255,255,255,0.02)_70%)]",
    mineBubbleClass: "bg-emerald-600 text-white",
    mineReplyButtonClass: "border-emerald-300/30 bg-emerald-500/25 text-emerald-100 hover:bg-emerald-500/40",
    chipClass: "bg-emerald-500/20 text-emerald-100 border-emerald-300/35",
    icon: Leaf,
    iconClass: "text-emerald-300",
    decorClass: "text-emerald-200/20",
    decorAltIcon: Sparkles,
    glowClass: "bg-emerald-500/25",
  },
  sunset: {
    label: "Sunset",
    description: "Теплые лучи заката и мягкое золотистое свечение",
    listClass: "bg-gradient-to-b from-orange-500/18 via-amber-500/10 to-transparent",
    headerOverlayClass:
      "bg-[radial-gradient(circle_at_82%_16%,rgba(251,191,36,0.24),transparent_42%),linear-gradient(to_right,rgba(249,115,22,0.2),rgba(255,255,255,0.02)_70%)]",
    mineBubbleClass: "bg-orange-600 text-white",
    mineReplyButtonClass: "border-amber-300/35 bg-orange-500/30 text-amber-100 hover:bg-orange-500/45",
    chipClass: "bg-orange-500/20 text-orange-100 border-amber-300/35",
    icon: Sun,
    iconClass: "text-amber-300",
    decorClass: "text-amber-200/20",
    decorAltIcon: Sparkles,
    glowClass: "bg-orange-500/30",
  },
  ocean: {
    label: "Ocean",
    description: "Водные иконки и прохладный морской оттенок",
    listClass: "bg-gradient-to-b from-cyan-500/16 via-sky-500/10 to-transparent",
    headerOverlayClass:
      "bg-[radial-gradient(circle_at_14%_20%,rgba(6,182,212,0.24),transparent_46%),linear-gradient(to_right,rgba(14,165,233,0.17),rgba(255,255,255,0.02)_70%)]",
    mineBubbleClass: "bg-cyan-700 text-white",
    mineReplyButtonClass: "border-cyan-300/35 bg-cyan-500/25 text-cyan-100 hover:bg-cyan-500/40",
    chipClass: "bg-cyan-500/20 text-cyan-100 border-cyan-300/35",
    icon: Droplets,
    iconClass: "text-cyan-300",
    decorClass: "text-cyan-200/20",
    decorAltIcon: Sparkles,
    glowClass: "bg-cyan-500/25",
  },
  midnight: {
    label: "Midnight",
    description: "Ночная тема с луной и холодным фиолетовым свечением",
    listClass: "bg-gradient-to-b from-indigo-500/16 via-violet-500/10 to-transparent",
    headerOverlayClass:
      "bg-[radial-gradient(circle_at_16%_18%,rgba(99,102,241,0.24),transparent_44%),linear-gradient(to_right,rgba(139,92,246,0.18),rgba(255,255,255,0.02)_70%)]",
    mineBubbleClass: "bg-indigo-700 text-white",
    mineReplyButtonClass: "border-indigo-300/35 bg-indigo-500/30 text-indigo-100 hover:bg-indigo-500/45",
    chipClass: "bg-indigo-500/20 text-indigo-100 border-indigo-300/35",
    icon: MoonStar,
    iconClass: "text-indigo-300",
    decorClass: "text-indigo-200/20",
    decorAltIcon: Sparkles,
    glowClass: "bg-indigo-500/25",
  },
};

type ThemeDecorPoint = {
  top: string;
  left: string;
  size: number;
  rotate: number;
  delay: number;
  duration: number;
};

const CHAT_THEME_DECOR_POINTS: ThemeDecorPoint[] = [
  { top: "8%", left: "5%", size: 14, rotate: -12, delay: 0.1, duration: 8.2 },
  { top: "15%", left: "90%", size: 13, rotate: 10, delay: 0.9, duration: 9.4 },
  { top: "30%", left: "8%", size: 15, rotate: -8, delay: 0.4, duration: 7.7 },
  { top: "44%", left: "92%", size: 14, rotate: 14, delay: 1.2, duration: 10.1 },
  { top: "61%", left: "6%", size: 13, rotate: -16, delay: 0.7, duration: 8.8 },
  { top: "74%", left: "90%", size: 15, rotate: 9, delay: 1.5, duration: 9.7 },
  { top: "88%", left: "12%", size: 12, rotate: 6, delay: 0.3, duration: 8.4 },
  { top: "92%", left: "84%", size: 13, rotate: -11, delay: 1.1, duration: 9.2 },
];

const getThemeDecorStyle = (theme: ChatThemeKey, point: ThemeDecorPoint, index: number): CSSProperties => {
  const style: CSSProperties = {
    top: point.top,
    left: point.left,
    width: `${point.size}px`,
    height: `${point.size}px`,
  };
  (style as Record<string, string>)["--chat-rotate"] = `${point.rotate}deg`;

  if (theme === "love") {
    style.animation = `chatFloatUp ${point.duration + 0.8}s ease-in-out ${point.delay}s infinite`;
    style.opacity = 0.26;
  } else if (theme === "nature") {
    style.animation = `chatSway ${point.duration + 0.5}s ease-in-out ${point.delay}s infinite`;
    style.opacity = 0.24;
  } else if (theme === "sunset") {
    style.animation = `chatPulseSoft ${point.duration + 1.2}s ease-in-out ${point.delay}s infinite`;
    style.opacity = 0.2;
  } else if (theme === "ocean") {
    style.animation = `chatBob ${point.duration + 0.2}s ease-in-out ${point.delay}s infinite`;
    style.opacity = 0.24;
  } else if (theme === "midnight") {
    style.animation = `chatTwinkle ${point.duration + 1.7}s ease-in-out ${point.delay}s infinite`;
    style.opacity = index % 2 === 0 ? 0.2 : 0.14;
  } else {
    style.animation = `chatTwinkle ${point.duration + 1}s ease-in-out ${point.delay}s infinite`;
    style.opacity = 0.12;
  }

  return style;
};

const normalizeChatThemeKey = (value?: string): ChatThemeKey => {
  const key = String(value || "").trim().toLowerCase() as ChatThemeKey;
  return key in CHAT_THEMES ? key : "default";
};

const toAsc = <T extends { created_at: string }>(items: T[]) =>
  [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

const mergeMessages = (current: UiMessage[], incoming: ChatMessage[]) => {
  const byID = new Map<string, UiMessage>();
  current.forEach((m) => byID.set(m.id, m));
  incoming.forEach((m) => {
    const prev = byID.get(m.id);
    byID.set(m.id, { ...(prev || {}), ...m, pending: false, failed: false });
  });
  return toAsc(Array.from(byID.values()));
};

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const trimReplyPreview = (value: string, max = 120) => {
  const flat = (value || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}...`;
};

const formatPresenceStatus = (participant?: ChatPreview["participant"] | null, nowMs = Date.now()) => {
  if (!participant) return "был(а) недавно";
  if (participant.is_online) return "в сети";

  const raw = String(participant.last_seen_at || "").trim();
  if (!raw) return "был(а) недавно";

  const ts = new Date(raw).getTime();
  if (!Number.isFinite(ts)) return "был(а) недавно";

  const diffMs = Math.max(0, nowMs - ts);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "был(а) только что";
  if (mins < 60) return `был(а) ${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `был(а) ${hours} ч назад`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `был(а) ${days} дн назад`;

  return `был(а) ${new Date(ts).toLocaleString([], {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
};

const POLL_INTERVAL_MS = 5000;
const DEBUG_CHAT = true;
const MAX_CHAT_ATTACHMENTS = 5;
const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const TYPING_IDLE_TIMEOUT_MS = 1400;
const TYPING_KEEPALIVE_MS = 1800;
const PEER_TYPING_TTL_MS = 2600;

const HEIC_MIME_SET = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const isHeicOrHeifFile = (file: File) => {
  const type = String(file.type || "").toLowerCase();
  if (HEIC_MIME_SET.has(type)) return true;
  if (type.includes("heic") || type.includes("heif")) return true;
  const name = String(file.name || "").trim().toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
};

const attachmentSignature = (msg: { attachments?: ChatMessageAttachment[] }) =>
  (msg.attachments || [])
    .map((a) => `${a.url}|${a.width}|${a.height}|${a.type}`)
    .join("||");

const chatWSURL = (chatId: string) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/chats/${encodeURIComponent(chatId)}/ws`;
};

const isIncomingMessageEvent = (
  evt: ChatSocketEvent
): evt is { type: "message_created" | "message.created"; chat_id: string; message: ChatMessage } =>
  evt.type === "message_created" || evt.type === "message.created";

const mergeIncomingMessage = (current: UiMessage[], incoming: ChatMessage) => {
  const incomingAttachmentSig = attachmentSignature(incoming);
  const incomingTs = new Date(incoming.created_at).getTime();
  const withoutMatchedPending = current.filter((m) => {
    if (!m.pending) return true;
    if ((m.body || "").trim() !== (incoming.body || "").trim()) return true;
    if ((m.reply_to_id || "") !== (incoming.reply_to_id || "")) return true;
    if (attachmentSignature(m) !== incomingAttachmentSig) return true;
    const pendingTs = new Date(m.created_at).getTime();
    return Math.abs(pendingTs - incomingTs) > 15000;
  });
  return mergeMessages(withoutMatchedPending, [incoming]);
};

const debugChat = (chatId: string, event: string, payload?: unknown) => {
  if (!DEBUG_CHAT) return;
  // eslint-disable-next-line no-console
  console.debug(`[chat:${chatId}] ${event}`, payload ?? "");
};

export default function ChatConversationPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const { chatId = "" } = useParams();

  const [chat, setChat] = useState<ChatPreview | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [themeKey, setThemeKey] = useState<ChatThemeKey>("default");
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState("");
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [viewer, setViewer] = useState<{ urls: string[]; initialIndex: number } | null>(null);
  const [presenceTick, setPresenceTick] = useState(() => Date.now());
  const [peerTyping, setPeerTyping] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pollInFlightRef = useRef(false);
  const autoScrollAfterRenderRef = useRef(false);
  const keepBottomPinnedRef = useRef(false);
  const initialAutoScrolledChatRef = useRef("");
  const wsConnectedRef = useRef(false);
  const peerIDRef = useRef("");
  const markReadInFlightRef = useRef(false);
  const lastMarkReadAtRef = useRef(0);
  const markReadRetryTimerRef = useRef<number | null>(null);
  const composerAttachmentsRef = useRef<ComposerAttachment[]>([]);
  const mediaErrorTimerRef = useRef<number | null>(null);
  const themeMenuRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingStateRef = useRef(false);
  const typingLastSentAtRef = useRef(0);
  const typingStopTimerRef = useRef<number | null>(null);
  const peerTypingTimerRef = useRef<number | null>(null);
  const releaseBottomPinTimerRef = useRef<number | null>(null);
  const viewportPinRafRef = useRef<number | null>(null);
  const viewportPinTimerARef = useRef<number | null>(null);
  const viewportPinTimerBRef = useRef<number | null>(null);

  const peerID = chat?.participant?.id || "";
  const peerDisplayName = chat?.participant?.full_name || chat?.participant?.username || "собеседник";
  const activeTheme = CHAT_THEMES[themeKey];
  const typingBubbleClass = useMemo(() => {
    switch (themeKey) {
      case "love":
        return "bg-rose-500/16";
      case "nature":
        return "bg-emerald-500/16";
      case "sunset":
        return "bg-orange-500/16";
      case "ocean":
        return "bg-cyan-500/16";
      case "midnight":
        return "bg-indigo-500/16";
      default:
        return "bg-white/10";
    }
  }, [themeKey]);
  const typingDotClass = useMemo(() => {
    switch (themeKey) {
      case "love":
        return "bg-rose-300";
      case "nature":
        return "bg-emerald-300";
      case "sunset":
        return "bg-amber-300";
      case "ocean":
        return "bg-cyan-300";
      case "midnight":
        return "bg-indigo-300";
      default:
        return "bg-white/90";
    }
  }, [themeKey]);
  const peerPresenceLabel = useMemo(
    () => formatPresenceStatus(chat?.participant, presenceTick),
    [chat?.participant, presenceTick]
  );

  useEffect(() => {
    const id = window.setInterval(() => {
      setPresenceTick(Date.now());
    }, 60_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    peerIDRef.current = peerID;
  }, [peerID]);

  useEffect(() => {
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  useEffect(() => {
    return () => {
      composerAttachmentsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
      });
      if (mediaErrorTimerRef.current !== null) {
        window.clearTimeout(mediaErrorTimerRef.current);
      }
    };
  }, []);

  const showMediaError = (message: string) => {
    setMediaError(message);
    if (mediaErrorTimerRef.current !== null) {
      window.clearTimeout(mediaErrorTimerRef.current);
    }
    mediaErrorTimerRef.current = window.setTimeout(() => {
      setMediaError("");
      mediaErrorTimerRef.current = null;
    }, 3200);
  };

  const clearComposerAttachments = () => {
    setComposerAttachments((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  };

  const removeComposerAttachment = (id: string) => {
    setComposerAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const uploadComposerAttachment = async (id: string, file: File) => {
    if (!token) {
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: "error", error: "Сначала авторизуйся" }
            : item
        )
      );
      return;
    }

    try {
      const uploaded = await api.uploadMedia([file], "chat", token);
      const first = uploaded[0];
      if (!first?.url) {
        throw new Error("upload_failed");
      }
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "uploaded",
                uploaded: {
                  url: first.url,
                  width: Number(first.width) || 0,
                  height: Number(first.height) || 0,
                  type: "image",
                },
                error: undefined,
              }
            : item
        )
      );
    } catch (e: any) {
      const msg = e?.message || "Не удалось загрузить файл";
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "error",
                error: msg,
              }
            : item
        )
      );
      showMediaError(msg);
    }
  };

  const handleAttachFiles = (files: FileList | null) => {
    if (!files) return;

    const incoming = Array.from(files);
    const allowed: ComposerAttachment[] = [];
    const existingCount = composerAttachmentsRef.current.length;
    let rejected = false;
    let hasSizeError = false;
    let hasTypeError = false;
    let hasHeicError = false;

    for (const file of incoming) {
      const type = String(file.type || "").toLowerCase();
      if (existingCount + allowed.length >= MAX_CHAT_ATTACHMENTS) {
        rejected = true;
        break;
      }
      if (isHeicOrHeifFile(file)) {
        rejected = true;
        hasHeicError = true;
        continue;
      }
      if (!type.startsWith("image/") || type === "image/svg+xml") {
        rejected = true;
        hasTypeError = true;
        continue;
      }
      if (file.size <= 0 || file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        rejected = true;
        hasSizeError = true;
        continue;
      }

      allowed.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
      });
    }

    if (rejected) {
      if (hasHeicError) {
        showMediaError("Формат HEIC/HEIF не поддерживается. Выберите JPG, PNG, WebP или GIF.");
      } else if (hasSizeError) {
        showMediaError("Максимальный размер файла 5MB.");
      } else if (hasTypeError) {
        showMediaError("Разрешены только изображения и GIF.");
      } else {
        showMediaError("Можно прикрепить максимум 5 изображений в одном сообщении.");
      }
    }

    if (allowed.length === 0) return;

    setComposerAttachments((prev) => [...prev, ...allowed]);
    allowed.forEach((item) => {
      void uploadComposerAttachment(item.id, item.file);
    });
  };

  const messageByID = useMemo(() => {
    const map = new Map<string, UiMessage>();
    messages.forEach((m) => map.set(m.id, m));
    return map;
  }, [messages]);

  const replyAuthorLabel = (senderID: string) => {
    if (senderID === peerID) return peerDisplayName;
    return "Вы";
  };

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const isNearBottom = (thresholdPx = 180) => {
    const el = listRef.current;
    if (!el) return true;
    const distanceToBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    return distanceToBottom <= thresholdPx;
  };

  const clearReleaseBottomPinTimer = () => {
    if (releaseBottomPinTimerRef.current !== null) {
      window.clearTimeout(releaseBottomPinTimerRef.current);
      releaseBottomPinTimerRef.current = null;
    }
  };

  const clearViewportPinTimers = () => {
    if (viewportPinRafRef.current !== null) {
      window.cancelAnimationFrame(viewportPinRafRef.current);
      viewportPinRafRef.current = null;
    }
    if (viewportPinTimerARef.current !== null) {
      window.clearTimeout(viewportPinTimerARef.current);
      viewportPinTimerARef.current = null;
    }
    if (viewportPinTimerBRef.current !== null) {
      window.clearTimeout(viewportPinTimerBRef.current);
      viewportPinTimerBRef.current = null;
    }
  };

  const pinListToBottom = (reason: string) => {
    clearViewportPinTimers();
    if (chatId) {
      debugChat(chatId, `pin_bottom:${reason}`);
    }
    viewportPinRafRef.current = window.requestAnimationFrame(() => {
      viewportPinRafRef.current = null;
      scrollToBottom("auto");
    });
    viewportPinTimerARef.current = window.setTimeout(() => {
      scrollToBottom("auto");
      viewportPinTimerARef.current = null;
    }, 40);
    viewportPinTimerBRef.current = window.setTimeout(() => {
      scrollToBottom("auto");
      viewportPinTimerBRef.current = null;
    }, 120);
  };

  const scheduleAutoScrollToBottom = (reason: string, payload?: unknown) => {
    autoScrollAfterRenderRef.current = true;
    if (chatId) {
      debugChat(chatId, `autoscroll_scheduled:${reason}`, payload);
    }
  };

  const clearTypingStopTimer = () => {
    if (typingStopTimerRef.current !== null) {
      window.clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
    }
  };

  const clearMarkReadRetryTimer = () => {
    if (markReadRetryTimerRef.current !== null) {
      window.clearTimeout(markReadRetryTimerRef.current);
      markReadRetryTimerRef.current = null;
    }
  };

  const clearPeerTypingTimer = () => {
    if (peerTypingTimerRef.current !== null) {
      window.clearTimeout(peerTypingTimerRef.current);
      peerTypingTimerRef.current = null;
    }
  };

  const sendTypingFrame = (isTyping: boolean, force = false) => {
    if (!chatId) return;
    const socket = wsRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    if (!force) {
      if (isTyping) {
        if (typingStateRef.current && now-typingLastSentAtRef.current < TYPING_KEEPALIVE_MS) {
          return;
        }
      } else if (!typingStateRef.current) {
        return;
      }
    }

    typingStateRef.current = isTyping;
    typingLastSentAtRef.current = now;
    try {
      socket.send(
        JSON.stringify({
          type: "typing",
          chat_id: chatId,
          is_typing: isTyping,
        })
      );
      debugChat(chatId, "typing_emit", { isTyping });
    } catch {
      // ignore WS send errors; reconnect logic handles connection state.
    }
  };

  const stopTyping = (force = false) => {
    clearTypingStopTimer();
    sendTypingFrame(false, force);
  };

  const scheduleTypingStop = () => {
    clearTypingStopTimer();
    typingStopTimerRef.current = window.setTimeout(() => {
      sendTypingFrame(false, true);
      typingStopTimerRef.current = null;
    }, TYPING_IDLE_TIMEOUT_MS);
  };

  const handleTypingByBody = (value: string) => {
    if (!value.trim()) {
      stopTyping(true);
      return;
    }
    sendTypingFrame(true);
    scheduleTypingStop();
  };

  useEffect(() => {
    return () => {
      clearMarkReadRetryTimer();
      clearTypingStopTimer();
      clearPeerTypingTimer();
      clearReleaseBottomPinTimer();
      clearViewportPinTimers();
    };
  }, []);

  const scheduleMarkReadRetry = (delayMs: number) => {
    if (markReadRetryTimerRef.current !== null) return;
    markReadRetryTimerRef.current = window.setTimeout(() => {
      markReadRetryTimerRef.current = null;
      markReadSafe(true);
    }, Math.max(80, delayMs));
  };

  const markReadSafe = (force = false) => {
    if (!token || !chatId) return;
    const now = Date.now();
    if (markReadInFlightRef.current) {
      scheduleMarkReadRetry(180);
      return;
    }
    const cooldownLeft = 1200 - (now - lastMarkReadAtRef.current);
    if (!force && cooldownLeft > 0) {
      scheduleMarkReadRetry(cooldownLeft + 40);
      return;
    }
    clearMarkReadRetryTimer();
    markReadInFlightRef.current = true;
    lastMarkReadAtRef.current = now;
    api
      .markChatRead(chatId, token)
      .catch(() => {
        scheduleMarkReadRetry(900);
      })
      .finally(() => {
        markReadInFlightRef.current = false;
      });
  };

  const loadInitial = async () => {
    if (!token || !chatId) return;
    setLoading(true);
    try {
      const [chatRes, msgRes, themeRes] = await Promise.all([
        api.chatById(chatId, token),
        api.chatMessages(chatId, 30, 0, token),
        api.chatTheme(chatId, token).catch(() => ({ theme_key: "default" })),
      ]);
      const initial = toAsc(msgRes.items);
      setChat(chatRes);
      setMessages(initial);
      setNextOffset(msgRes.nextOffset);
      setThemeKey(normalizeChatThemeKey(themeRes.theme_key));
      setError("");

      requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
      markReadSafe(true);
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить чат");
    } finally {
      setLoading(false);
    }
  };

  const changeTheme = async (nextTheme: ChatThemeKey) => {
    if (!token || !chatId || themeSaving || nextTheme === themeKey) return;
    const prevTheme = themeKey;
    setThemeKey(nextTheme);
    setThemeSaving(true);
    setThemeError("");
    try {
      const res = await api.setChatTheme(chatId, nextTheme, token);
      setThemeKey(normalizeChatThemeKey(res.theme_key));
      setThemeMenuOpen(false);
    } catch (e: any) {
      setThemeKey(prevTheme);
      setThemeError(e.message || "Не удалось изменить тему чата");
    } finally {
      setThemeSaving(false);
    }
  };

  const loadOlder = async () => {
    if (!token || !chatId || nextOffset === null || loadingMore || loading) return;
    const el = listRef.current;
    const prevTop = el?.scrollTop ?? 0;
    const prevHeight = el?.scrollHeight ?? 0;

    setLoadingMore(true);
    try {
      const res = await api.chatMessages(chatId, 30, nextOffset, token);
      setMessages((prev) => mergeMessages(prev, toAsc(res.items)));
      setNextOffset(res.nextOffset);
      requestAnimationFrame(() => {
        const box = listRef.current;
        if (!box) return;
        const delta = box.scrollHeight - prevHeight;
        box.scrollTop = prevTop + delta;
      });
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить историю");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadInitial();
  }, [chatId, token]);

  useEffect(() => {
    stopTyping(true);
    clearMarkReadRetryTimer();
    clearReleaseBottomPinTimer();
    clearViewportPinTimers();
    keepBottomPinnedRef.current = false;
    markReadInFlightRef.current = false;
    lastMarkReadAtRef.current = 0;
    typingStateRef.current = false;
    typingLastSentAtRef.current = 0;
    setPeerTyping(false);
    clearPeerTypingTimer();
    setReplyTo(null);
    initialAutoScrolledChatRef.current = "";
    setViewer(null);
    setThemeKey("default");
    setThemeError("");
    setThemeSaving(false);
    setThemeMenuOpen(false);
    setMediaError("");
    setComposerAttachments((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, [chatId]);

  useEffect(() => {
    if (!themeMenuOpen) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (themeMenuRef.current?.contains(target)) return;
      setThemeMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setThemeMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [themeMenuOpen]);

  useEffect(() => {
    if (!chatId || loading || messages.length === 0) return;
    if (initialAutoScrolledChatRef.current === chatId) return;
    initialAutoScrolledChatRef.current = chatId;
    debugChat(chatId, "autoscroll_initial_open", { messageCount: messages.length });

    requestAnimationFrame(() => {
      scrollToBottom("auto");
      window.setTimeout(() => scrollToBottom("auto"), 60);
      window.setTimeout(() => scrollToBottom("auto"), 180);
    });
  }, [chatId, loading, messages.length]);

  useEffect(() => {
    if (!autoScrollAfterRenderRef.current) return;
    autoScrollAfterRenderRef.current = false;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      window.setTimeout(() => {
        const box = listRef.current;
        if (!box) return;
        box.scrollTop = box.scrollHeight;
      }, 60);
    });
  }, [messages]);

  useEffect(() => {
    if (!peerTyping) return;
    const el = listRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.clientHeight - el.scrollTop;
    if (distanceToBottom <= 140) {
      requestAnimationFrame(() => {
        scrollToBottom("smooth");
      });
    }
  }, [peerTyping]);

  useEffect(() => {
    if (!chatId) return;
    const viewport = window.visualViewport;

    const handleViewportChange = () => {
      if (window.innerWidth >= 871) return;
      const composerFocused = document.activeElement === composerInputRef.current;
      if (!(keepBottomPinnedRef.current || composerFocused || isNearBottom(200))) {
        return;
      }
      pinListToBottom("viewport_change");
    };

    handleViewportChange();
    viewport?.addEventListener("resize", handleViewportChange);
    viewport?.addEventListener("scroll", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    document.addEventListener("focusin", handleViewportChange);
    document.addEventListener("focusout", handleViewportChange);

    return () => {
      viewport?.removeEventListener("resize", handleViewportChange);
      viewport?.removeEventListener("scroll", handleViewportChange);
      window.removeEventListener("orientationchange", handleViewportChange);
      document.removeEventListener("focusin", handleViewportChange);
      document.removeEventListener("focusout", handleViewportChange);
    };
  }, [chatId]);

  useEffect(() => {
    if (!chatId) return;
    debugChat(chatId, "mount", { queryKey: ["chatMessages", chatId, "latest"] });
    return () => {
      debugChat(chatId, "unmount");
    };
  }, [chatId]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    const top = topRef.current;
    if (!top || nextOffset === null || loading || loadingMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) loadOlder();
      },
      { root: listRef.current, rootMargin: "120px 0px 0px 0px" }
    );
    observerRef.current.observe(top);
    return () => observerRef.current?.disconnect();
  }, [nextOffset, loading, loadingMore, token, chatId]);

  useEffect(() => {
    if (!token || !chatId) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;

    const reconnect = () => {
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** attempts, 10000);
      attempts += 1;
      debugChat(chatId, "ws_schedule_reconnect", { delayMs: delay });
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (stopped) return;
      debugChat(chatId, "ws_connect_start");
      socket = new WebSocket(chatWSURL(chatId));
      wsRef.current = socket;

      socket.onopen = () => {
        debugChat(chatId, "ws_open", { queryKey: ["chatMessages", chatId, "latest"] });
        wsConnectedRef.current = true;
        socket?.send(
          JSON.stringify({
            type: "auth",
            token,
          })
        );
        attempts = 0;
        // Re-sync latest page after reconnect to avoid gaps.
        api
          .chatMessages(chatId, 30, 0, token)
          .then((res) => {
            if (stopped) return;
            setMessages((prev) => {
              const merged = mergeMessages(prev, toAsc(res.items));
              if (merged.length !== prev.length) {
                debugChat(chatId, "ws_resync_state_updated", {
                  before: prev.length,
                  after: merged.length,
                });
              }
              return merged;
            });
            setNextOffset((prev) => (prev === null ? res.nextOffset : prev));
          })
          .catch(() => {});
      };

      socket.onmessage = (evt) => {
        let parsed: ChatSocketEvent | null = null;
        try {
          parsed = JSON.parse(String(evt.data)) as ChatSocketEvent;
        } catch {
          return;
        }
        if (!parsed) return;

        if (parsed.type === "error" && parsed.message) {
          debugChat(chatId, "ws_error_event", parsed.message);
          setError(parsed.message);
          return;
        }

        if (parsed.type === "chat_theme_updated" && parsed.chat_id === chatId) {
          const nextTheme = normalizeChatThemeKey(parsed.theme_key);
          debugChat(chatId, "ws_theme_updated", { theme: nextTheme });
          setThemeKey(nextTheme);
          setThemeError("");
          return;
        }

        if (parsed.type === "chat_presence_updated" && parsed.chat_id === chatId) {
          debugChat(chatId, "ws_presence_updated", {
            userId: parsed.user_id,
            isOnline: parsed.is_online,
            lastSeenAt: parsed.last_seen_at || "",
          });
          setChat((prev) => {
            if (!prev) return prev;
            if (prev.participant.id !== parsed.user_id) return prev;
            return {
              ...prev,
              participant: {
                ...prev.participant,
                is_online: parsed.is_online,
                last_seen_at: parsed.last_seen_at || prev.participant.last_seen_at,
              },
            };
          });
          return;
        }

        if (parsed.type === "chat_typing" && parsed.chat_id === chatId) {
          const isPeer = parsed.user_id === peerIDRef.current;
          if (!isPeer) return;
          debugChat(chatId, "ws_typing", {
            userId: parsed.user_id,
            isTyping: parsed.is_typing,
          });
          if (parsed.is_typing) {
            setPeerTyping(true);
            clearPeerTypingTimer();
            peerTypingTimerRef.current = window.setTimeout(() => {
              setPeerTyping(false);
              peerTypingTimerRef.current = null;
            }, PEER_TYPING_TTL_MS);
          } else {
            setPeerTyping(false);
            clearPeerTypingTimer();
          }
          return;
        }

        if (parsed.type === "messages_read" && parsed.chat_id === chatId) {
          const ids = Array.isArray(parsed.message_ids) ? parsed.message_ids : [];
          if (ids.length === 0) return;
          const idsSet = new Set(ids);
          const readAt = String(parsed.read_at || new Date().toISOString()).trim();
          debugChat(chatId, "ws_messages_read", {
            userId: parsed.user_id,
            count: idsSet.size,
            readAt,
          });
          let applied = false;
          setMessages((prev) => {
            let changed = false;
            const next = prev.map((msg) => {
              if (!idsSet.has(msg.id)) return msg;
              if ((msg.read_at || "") === readAt) return msg;
              changed = true;
              return {
                ...msg,
                read_at: readAt,
              };
            });
            applied = changed;
            return changed ? next : prev;
          });
          if (!applied && token) {
            void api
              .chatMessages(chatId, 30, 0, token)
              .then((res) => {
                setMessages((prev) => mergeMessages(prev, toAsc(res.items)));
              })
              .catch(() => {});
          }
          return;
        }

        if (isIncomingMessageEvent(parsed) && parsed.chat_id === chatId) {
          debugChat(chatId, "ws_message_received", {
            messageId: parsed.message.id,
            senderId: parsed.message.sender_id,
          });
          if (peerIDRef.current && parsed.message.sender_id === peerIDRef.current) {
            setPeerTyping(false);
            clearPeerTypingTimer();
          }
          setMessages((prev) => {
            const merged = mergeIncomingMessage(prev, parsed.message);
            const prevLastID = prev.at(-1)?.id;
            const mergedLastID = merged.at(-1)?.id;
            if (mergedLastID && mergedLastID !== prevLastID) {
              scheduleAutoScrollToBottom("ws_new_message", {
                messageId: mergedLastID,
              });
            }
            debugChat(chatId, "ws_state_updated", {
              before: prev.length,
              after: merged.length,
              messageId: parsed.message.id,
            });
            return merged;
          });
          setChat((prev) =>
            prev
              ? {
                  ...prev,
                  last_message: {
                    id: parsed.message.id,
                    sender_id: parsed.message.sender_id,
                    body: parsed.message.body,
                    created_at: parsed.message.created_at,
                  },
                  last_message_at: parsed.message.created_at,
                }
              : prev
          );
          if (peerIDRef.current && parsed.message.sender_id === peerIDRef.current) {
            markReadSafe(true);
          }
        }
      };

      socket.onerror = () => {
        debugChat(chatId, "ws_error");
        socket?.close();
      };

      socket.onclose = () => {
        debugChat(chatId, "ws_close");
        wsConnectedRef.current = false;
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        typingStateRef.current = false;
        if (stopped) return;
        reconnect();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      clearPeerTypingTimer();
      setPeerTyping(false);
      if (socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(
            JSON.stringify({
              type: "typing",
              chat_id: chatId,
              is_typing: false,
            })
          );
        } catch {
          // ignore
        }
      }
      debugChat(chatId, "ws_cleanup");
      wsConnectedRef.current = false;
      typingStateRef.current = false;
      if (wsRef.current === socket) {
        wsRef.current = null;
      }
      socket?.close();
    };
  }, [token, chatId]);

  useEffect(() => {
    if (!token || !chatId) return;

    const runPoll = async () => {
      if (pollInFlightRef.current || loading || loadingMore) return;
      if (wsConnectedRef.current) return;
      if (document.visibilityState !== "visible") return;
      pollInFlightRef.current = true;
      try {
        const res = await api.chatMessages(chatId, 30, 0, token);
        setMessages((prev) => {
          const prevIDs = new Set(prev.map((m) => m.id));
          const merged = mergeMessages(prev, toAsc(res.items));
          let hasNewPeerMessage = false;
          const currentPeerID = peerIDRef.current;
          if (currentPeerID) {
            for (const m of merged) {
              if (!prevIDs.has(m.id) && m.sender_id === currentPeerID) {
                hasNewPeerMessage = true;
                break;
              }
            }
          }
          const prevLastID = prev.at(-1)?.id;
          const mergedLastID = merged.at(-1)?.id;
          if (mergedLastID && mergedLastID !== prevLastID) {
            scheduleAutoScrollToBottom("poll_new_message", {
              messageId: mergedLastID,
            });
          }
          if (hasNewPeerMessage) {
            markReadSafe();
          }
          if (merged.length !== prev.length) {
            debugChat(chatId, "poll_state_updated", {
              before: prev.length,
              after: merged.length,
              queryKey: ["chatMessages", chatId, "latest"],
            });
          }
          return merged;
        });
      } catch (e) {
        debugChat(chatId, "poll_error", e);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const id = window.setInterval(runPoll, POLL_INTERVAL_MS);
    debugChat(chatId, "poll_started", { intervalMs: POLL_INTERVAL_MS });
    return () => {
      window.clearInterval(id);
      debugChat(chatId, "poll_stopped");
    };
  }, [token, chatId, loading, loadingMore]);

  const sendMessage = async () => {
    if (!token || !chatId || sending) return;
    const text = body.trim();
    const activeComposerAttachments = composerAttachmentsRef.current;
    const hasUploadingAttachments = activeComposerAttachments.some((a) => a.status === "uploading");
    if (hasUploadingAttachments) {
      setError("Дождитесь завершения загрузки вложений.");
      return;
    }
    const hasFailedAttachments = activeComposerAttachments.some((a) => a.status === "error");
    if (hasFailedAttachments) {
      setError("Есть вложения с ошибкой. Удалите их или загрузите заново.");
      return;
    }
    const uploadedAttachments = activeComposerAttachments
      .filter((a): a is ComposerAttachment & { uploaded: ChatMessageAttachment } => a.status === "uploaded" && !!a.uploaded)
      .map((a) => a.uploaded);

    if (!text && uploadedAttachments.length === 0) return;
    const activeReply = replyTo;

    const tempID = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: UiMessage = {
      id: tempID,
      chat_id: chatId,
      sender_id: "me",
      reply_to_id: activeReply?.id,
      body: text,
      attachments: uploadedAttachments,
      created_at: new Date().toISOString(),
      pending: true,
    };

    stopTyping(true);
    if (window.innerWidth < 871) {
      keepBottomPinnedRef.current = true;
      clearReleaseBottomPinTimer();
      pinListToBottom("send_start");
    }
    setError("");
    setBody("");
    setReplyTo(null);
    clearComposerAttachments();
    setMessages((prev) => toAsc([...prev, optimistic]));
    requestAnimationFrame(() => {
      scrollToBottom("smooth");
    });

    setSending(true);
    try {
      const saved = await api.sendChatMessage(chatId, text, token, activeReply?.id, uploadedAttachments);
      setMessages((prev) => toAsc(prev.map((m) => (m.id === tempID ? { ...saved } : m))));
      setChat((prev) =>
        prev
          ? {
              ...prev,
              last_message: {
                id: saved.id,
                sender_id: saved.sender_id,
                body: saved.body,
                created_at: saved.created_at,
              },
              last_message_at: saved.created_at,
            }
          : prev
      );
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempID ? { ...m, pending: false, failed: true } : m))
      );
      setError(e.message || "Не удалось отправить сообщение");
    } finally {
      setSending(false);
      if (window.innerWidth < 871 && document.activeElement !== composerInputRef.current) {
        clearReleaseBottomPinTimer();
        releaseBottomPinTimerRef.current = window.setTimeout(() => {
          keepBottomPinnedRef.current = false;
          releaseBottomPinTimerRef.current = null;
        }, 220);
      }
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage();
  };

  const hasUploadingComposer = composerAttachments.some((item) => item.status === "uploading");
  const hasFailedComposer = composerAttachments.some((item) => item.status === "error");
  const hasUploadedComposer = composerAttachments.some((item) => item.status === "uploaded" && !!item.uploaded);
  const canSend = !sending && !hasUploadingComposer && !hasFailedComposer && (body.trim().length > 0 || hasUploadedComposer);

  if (!loading && !chat) {
    return (
      <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-4 page-fade">
        <ErrorMessage message={error || "Чат не найден"} />
        <button
          type="button"
          onClick={() => navigate("/chats")}
          className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40 transition"
        >
          Назад к чатам
        </button>
      </main>
    );
  }

  return (
    <main
      data-page-root
      className="max-w-[672px] w-full mx-auto h-full py-3 min-[871px]:py-6 space-y-3 page-fade flex flex-col overflow-hidden min-[871px]:overflow-visible"
    >
      <div className="card p-3 flex items-center gap-3 relative">
        <div className="pointer-events-none absolute inset-0 rounded-[18px] overflow-hidden">
          <div className={`absolute inset-0 ${activeTheme.headerOverlayClass}`} />
          <div
            className={`absolute -left-6 top-1/2 h-14 w-52 -translate-y-1/2 rounded-full blur-2xl ${activeTheme.glowClass}`}
            style={{ animation: "chatPulseSoft 8.4s ease-in-out infinite", opacity: 0.55 }}
          />
          <activeTheme.icon
            className={`absolute right-16 top-1/2 -translate-y-1/2 w-7 h-7 ${activeTheme.decorClass}`}
            style={{ animation: "chatTwinkle 7.6s ease-in-out infinite" }}
          />
        </div>
        <button
          type="button"
          onClick={() => navigate("/chats")}
          className="relative z-10 w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 grid place-items-center"
          aria-label="Назад"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        {chat ? (
          <div className="relative z-10 flex-1 min-w-0 rounded-2xl px-2.5 py-1.5 flex items-center gap-3">
            <AvatarCircle
              src={chat.participant.avatar_url}
              fallback={chat.participant.full_name || chat.participant.username}
              className="w-10 h-10 text-sm font-semibold"
              alt={chat.participant.username}
            />
            <div className="min-w-0">
              <p className="text-white font-semibold truncate inline-flex items-center gap-[3px]">
                <span>{chat.participant.full_name}</span>
                {chat.participant.is_verified ? <VerifiedBadge /> : null}
              </p>
              <p
                className={`text-sm truncate ${
                  chat.participant.is_online ? "text-emerald-300" : "text-white/60"
                }`}
              >
                {peerPresenceLabel}
              </p>
            </div>
          </div>
        ) : (
          <div className="text-white/60 text-sm">Загрузка...</div>
        )}
        <div className="ml-auto relative z-20" ref={themeMenuRef}>
          <button
            type="button"
            onClick={() => setThemeMenuOpen((prev) => !prev)}
            className="w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 grid place-items-center"
            aria-label="Настройки чата"
            title="Настройки чата"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
	          {themeMenuOpen && (
	            <div className="absolute right-0 top-11 z-30 w-72 rounded-xl border border-white/15 bg-[#0b0b0f]/95 backdrop-blur p-2 shadow-2xl">
	              <p className="px-2 pb-2 text-[11px] text-white/55">Тема чата</p>
	              <div className="space-y-1">
	                {CHAT_THEME_ORDER.map((key) => {
	                  const cfg = CHAT_THEMES[key];
	                  const isActive = key === themeKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => void changeTheme(key)}
                      disabled={themeSaving}
	                      className={`w-full rounded-lg border px-3 py-2 text-left transition disabled:opacity-60 ${
	                        isActive
	                          ? "border-white/40 bg-white/10 text-white"
	                          : "border-white/10 bg-black/30 text-white/80 hover:border-white/25 hover:text-white"
	                      }`}
	                    >
	                      <div className="flex items-center gap-2">
	                        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${cfg.chipClass}`}>
	                          <cfg.icon className={`w-3.5 h-3.5 ${cfg.iconClass}`} />
	                        </span>
	                        <div className="min-w-0 flex-1">
	                          <p className="truncate text-sm">{cfg.label}</p>
	                          <p className="truncate text-[11px] text-white/55">{cfg.description}</p>
	                        </div>
	                        {isActive ? <span className="text-[11px] text-white/70">active</span> : null}
	                      </div>
	                    </button>
	                  );
	                })}
	              </div>
              {themeSaving && (
                <div className="pt-2 flex items-center gap-2 text-xs text-white/60 px-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Сохраняем...</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ErrorMessage message={themeError} />
      <ErrorMessage message={error} />

      <div className="card relative overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className={`absolute -top-16 -right-14 h-44 w-44 rounded-full blur-3xl ${activeTheme.glowClass}`}
            style={{ animation: "chatPulseSoft 8.8s ease-in-out infinite" }}
          />
          <div
            className={`absolute -bottom-20 -left-14 h-48 w-48 rounded-full blur-3xl ${activeTheme.glowClass}`}
            style={{ animation: "chatPulseSoft 11.2s ease-in-out 0.7s infinite" }}
          />

          {themeKey === "default" && (
            <>
              <div className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(rgba(255,255,255,0.18)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.18)_1px,transparent_1px)] [background-size:26px_26px]" />
              <div
                className="absolute left-[62%] top-[13%] h-28 w-28 rounded-full bg-white/10 blur-2xl"
                style={{ animation: "chatPulseSoft 9.8s ease-in-out infinite" }}
              />
            </>
          )}

          {themeKey === "love" && (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(244,63,94,0.28),transparent_42%),radial-gradient(circle_at_84%_82%,rgba(236,72,153,0.20),transparent_36%)]" />
              <div
                className="absolute left-[10%] top-[14%] h-20 w-20 rounded-full bg-rose-400/20 blur-2xl"
                style={{ animation: "chatPulseSoft 8.1s ease-in-out 0.4s infinite" }}
              />
            </>
          )}

          {themeKey === "nature" && (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_10%_15%,rgba(16,185,129,0.2),transparent_40%),radial-gradient(circle_at_86%_75%,rgba(34,197,94,0.18),transparent_38%)]" />
              <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-emerald-700/20 to-transparent" />
            </>
          )}

          {themeKey === "sunset" && (
            <>
              <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(251,146,60,0.2),transparent_45%),radial-gradient(circle_at_84%_14%,rgba(253,186,116,0.24),transparent_35%)]" />
              <div
                className="absolute -right-8 top-5 h-24 w-24 rounded-full bg-amber-300/25 blur-xl"
                style={{ animation: "chatPulseSoft 7.9s ease-in-out infinite" }}
              />
              <div
                className="absolute inset-x-[-12%] top-[22%] h-px bg-gradient-to-r from-transparent via-amber-200/35 to-transparent"
                style={{ animation: "chatWaveSlide 12.5s ease-in-out infinite" }}
              />
              <div
                className="absolute inset-x-[-8%] top-[28%] h-px bg-gradient-to-r from-transparent via-orange-200/25 to-transparent"
                style={{ animation: "chatWaveSlide 10.2s ease-in-out 0.6s infinite" }}
              />
            </>
          )}

          {themeKey === "ocean" && (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(56,189,248,0.2),transparent_36%),linear-gradient(to_bottom,rgba(6,182,212,0.12),transparent_34%)]" />
              <div
                className="absolute -left-10 bottom-10 h-16 w-[130%] rounded-[100%] border-t border-cyan-200/20"
                style={{ animation: "chatWaveSlide 11.6s ease-in-out infinite" }}
              />
              <div
                className="absolute -left-12 bottom-4 h-20 w-[135%] rounded-[100%] border-t border-sky-200/15"
                style={{ animation: "chatWaveSlide 9.4s ease-in-out 0.7s infinite" }}
              />
            </>
          )}

          {themeKey === "midnight" && (
            <>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_84%_12%,rgba(99,102,241,0.24),transparent_34%),radial-gradient(circle_at_16%_88%,rgba(168,85,247,0.16),transparent_36%)]" />
              <div
                className="absolute right-10 top-8 h-16 w-16 rounded-full bg-indigo-300/20 blur-xl"
                style={{ animation: "chatPulseSoft 9.3s ease-in-out infinite" }}
              />
              <div className="absolute right-[16%] top-[11%] text-indigo-200/55">
                <Sparkles className="h-3.5 w-3.5" style={{ animation: "chatOrbit 9s linear infinite" }} />
              </div>
            </>
          )}

          {CHAT_THEME_DECOR_POINTS.map((point, idx) => {
            const DecorIcon = idx % 2 === 0 ? activeTheme.icon : activeTheme.decorAltIcon;
            return (
              <DecorIcon
                key={`${themeKey}-decor-${idx}`}
                className={`absolute ${activeTheme.decorClass}`}
                style={getThemeDecorStyle(themeKey, point, idx)}
              />
            );
          })}
        </div>
        <div
          ref={listRef}
          className={`relative z-10 flex-1 min-h-0 min-[871px]:h-[64vh] min-[871px]:flex-none overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch] scrollbar-hide px-3 py-4 space-y-3 ${activeTheme.listClass}`.trim()}
        >
          <div ref={topRef} className="h-6 flex items-center justify-center">
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-white/60" />}
          </div>

          {loading && (
            <div className="space-y-2 animate-pulse">
              <div className="ml-auto h-12 w-2/3 rounded-2xl bg-white/10" />
              <div className="h-12 w-2/3 rounded-2xl bg-white/10" />
              <div className="ml-auto h-10 w-1/2 rounded-2xl bg-white/10" />
            </div>
          )}

          {!loading && messages.length === 0 && (
            <div className="h-full min-h-[240px] flex items-center justify-center text-white/60 text-sm">
              Сообщений пока нет. Начните диалог.
            </div>
          )}

          {messages.map((m) => {
            const mine = peerID ? m.sender_id !== peerID : m.sender_id === "me";
            const repliedMessage = m.reply_to_id ? messageByID.get(m.reply_to_id) : undefined;
            const replyPreview = repliedMessage ? trimReplyPreview(repliedMessage.body, 90) : "Сообщение";
            const replyPreviewAuthor = repliedMessage ? replyAuthorLabel(repliedMessage.sender_id) : "Ответ";
            const messageAttachments = (m.attachments || []).filter((att) => String(att.url || "").trim() !== "");
            const hasBody = (m.body || "").trim().length > 0;
            const attachmentUrls = messageAttachments.map((att) => att.url);
            const isMultiAttachment = messageAttachments.length > 1;
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`group flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                  <button
                    type="button"
                    disabled={m.pending}
                    onClick={() =>
                      setReplyTo({
                        id: m.id,
                        sender_id: m.sender_id,
                        body: m.body,
                      })
                    }
                    className={`h-8 w-8 shrink-0 rounded-full border transition ${
                      mine
                        ? activeTheme.mineReplyButtonClass
                        : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    aria-label="Ответить"
                    title="Ответить"
                  >
                    <Reply className="w-3.5 h-3.5 mx-auto" />
                  </button>
                  <div
                    className={`${
                      messageAttachments.length > 0
                        ? "w-[min(66vw,21rem)] max-w-[21rem] sm:w-[min(78vw,28rem)] sm:max-w-[28rem]"
                        : "max-w-[78%]"
                    } rounded-2xl px-3 py-2 break-words whitespace-pre-wrap ${
                      mine
                        ? activeTheme.mineBubbleClass
                        : "bg-[#1f232d] text-white"
                    }`}
                  >
                    {m.reply_to_id && (
                      <div
                        className={`mb-2 rounded-xl border px-2 py-1.5 ${
                          mine
                            ? "border-white/20 bg-black/15 text-white/90"
                            : "border-white/15 bg-black/30 text-white/80"
                        }`}
                      >
                        <p className="text-[11px] font-semibold leading-tight">{replyPreviewAuthor}</p>
                        <p className={`text-xs leading-tight ${mine ? "text-white/80" : "text-white/70"}`}>
                          {replyPreview}
                        </p>
                      </div>
                    )}
                    {messageAttachments.length > 0 && (
                      <div
                        className={`grid w-full gap-2 ${
                          isMultiAttachment ? "grid-cols-2" : "grid-cols-1"
                        } ${hasBody ? "mb-2" : ""}`}
                      >
                        {messageAttachments.map((att, idx) => (
                          <button
                            type="button"
                            key={`${m.id}-attachment-${idx}`}
                            onClick={() => setViewer({ urls: attachmentUrls, initialIndex: idx })}
                            className="w-full overflow-hidden rounded-xl focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 bg-black"
                            aria-label={`Открыть вложение ${idx + 1}`}
                          >
                            <img
                              src={att.url}
                              alt="attachment"
                              className={`w-full bg-black ${
                                isMultiAttachment
                                  ? "h-32 sm:h-44 object-cover"
                                  : "max-h-[260px] sm:max-h-[420px] h-auto object-contain"
                              }`}
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {hasBody && <p className="text-sm leading-relaxed">{m.body}</p>}
                    <div
                      className={`mt-1 text-[11px] ${
                        mine
                          ? "text-right text-white/70 inline-flex w-full items-center justify-end gap-1"
                          : "text-left text-white/50"
                      }`}
                    >
                      <span>{timeLabel(m.created_at)}</span>
                      {mine && !m.pending && !m.failed ? (
                        m.read_at ? (
                          <CheckCheck
                            className="w-4 h-4 text-cyan-300 drop-shadow-[0_0_6px_rgba(34,211,238,0.65)]"
                            aria-label="Прочитано"
                            title="Прочитано"
                          />
                        ) : (
                          <Check
                            className="w-4 h-4 text-white/70"
                            aria-label="Отправлено"
                            title="Отправлено"
                          />
                        )
                      ) : null}
                      {m.pending ? <span>· отправка...</span> : null}
                      {m.failed ? <span>· ошибка</span> : null}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

          {peerTyping && !loading && (
            <div className="flex justify-start" aria-live="polite">
              <div className="flex items-end gap-2">
                <AvatarCircle
                  src={chat?.participant.avatar_url}
                  fallback={chat?.participant.full_name || chat?.participant.username || "U"}
                  className="w-7 h-7 text-[11px] font-semibold ring-1 ring-white/20"
                  alt={chat?.participant.username || "user"}
                />
                <div className={`max-w-[84%] rounded-2xl px-3.5 py-2 ${typingBubbleClass}`}>
                  <div className="flex items-center gap-1.5" aria-label="Собеседник печатает">
                    <span className={`h-1.5 w-1.5 rounded-full animate-bounce [animation-duration:900ms] ${typingDotClass}`} />
                    <span
                      className={`h-1.5 w-1.5 rounded-full animate-bounce [animation-duration:900ms] ${typingDotClass}`}
                      style={{ animationDelay: "120ms" }}
                    />
                    <span
                      className={`h-1.5 w-1.5 rounded-full animate-bounce [animation-duration:900ms] ${typingDotClass}`}
                      style={{ animationDelay: "240ms" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <form
          onSubmit={onSubmit}
          className="border-t border-white/10 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] space-y-2"
        >
          <ErrorMessage message={mediaError} />
          {composerAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {composerAttachments.map((item, idx) => {
                const previewUrls = composerAttachments.map((x) => x.previewUrl);
                return (
                  <div
                    key={item.id}
                    className="relative h-16 w-16 overflow-hidden rounded-xl border border-white/15 bg-black/30"
                  >
                    <button
                      type="button"
                      onClick={() => setViewer({ urls: previewUrls, initialIndex: idx })}
                      className="h-full w-full"
                      aria-label={`Открыть выбранное изображение ${idx + 1}`}
                    >
                      <img
                        src={item.previewUrl}
                        alt="selected attachment"
                        className="h-full w-full object-cover"
                      />
                    </button>
                    {item.status === "uploading" && (
                      <div className="absolute inset-0 bg-black/55 grid place-items-center">
                        <Loader2 className="w-4 h-4 animate-spin text-white/80" />
                      </div>
                    )}
                    {item.status === "error" && (
                      <div className="absolute inset-0 bg-red-500/35 grid place-items-center px-1">
                        <span className="text-[10px] text-white text-center leading-tight">Ошибка</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeComposerAttachment(item.id)}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full border border-white/20 bg-black/70 text-white/90 hover:bg-black"
                      aria-label="Удалить вложение"
                    >
                      <X className="w-3 h-3 mx-auto" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {replyTo && (
            <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-white/60">Ответ на {replyAuthorLabel(replyTo.sender_id)}</p>
                <p className="text-xs text-white/90 truncate">{trimReplyPreview(replyTo.body, 140)}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="h-6 w-6 rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 grid place-items-center"
                aria-label="Убрать reply"
                title="Убрать reply"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="nav-icon shrink-0 self-center bg-white/10 text-white/60 hover:bg-white/20 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="attach"
              disabled={composerAttachments.length >= MAX_CHAT_ATTACHMENTS || sending}
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.gif,image/*,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                handleAttachFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <textarea
              ref={composerInputRef}
              value={body}
              onChange={(e) => {
                const nextValue = e.target.value;
                setBody(nextValue);
                handleTypingByBody(nextValue);
              }}
              onFocus={() => {
                keepBottomPinnedRef.current = true;
                clearReleaseBottomPinTimer();
                pinListToBottom("composer_focus");
              }}
              onBlur={() => {
                stopTyping(true);
                pinListToBottom("composer_blur");
                clearReleaseBottomPinTimer();
                releaseBottomPinTimerRef.current = window.setTimeout(() => {
                  keepBottomPinnedRef.current = false;
                  releaseBottomPinTimerRef.current = null;
                }, 260);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Напишите сообщение..."
              rows={1}
              className="flex-1 h-12 resize-none overflow-y-auto rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-white text-base md:text-sm leading-5 placeholder:text-white/35 focus:outline-none focus:border-white/30"
            />
            <button
              type="submit"
              disabled={!canSend}
              className="nav-icon shrink-0 self-center bg-white/10 text-white/60 hover:bg-white/20 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="send"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <SendHorizontal className="w-5 h-5" />}
            </button>
          </div>
          {(hasUploadingComposer || hasFailedComposer) && (
            <p className="text-[11px] text-white/55">
              {hasUploadingComposer
                ? "Загрузка вложений..."
                : "Есть вложения с ошибкой. Удалите их перед отправкой."}
            </p>
          )}
        </form>
      </div>
      {viewer && (
        <MediaViewerModal
          urls={viewer.urls}
          initialIndex={viewer.initialIndex}
          onClose={() => setViewer(null)}
        />
      )}
    </main>
  );
}

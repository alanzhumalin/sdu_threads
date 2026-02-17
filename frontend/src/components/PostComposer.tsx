import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { usePostCooldownStore } from "../store/postCooldown";
import { Image as ImageIcon, X, Edit3, Trash2, Paintbrush, Smile, Music2 } from "lucide-react";
import { DrawingModal } from "./DrawingModal";
import { ErrorMessage } from "./ErrorMessage";
import FabricImageEditor from "./FabricImageEditor";
import { VerifiedBadge } from "./VerifiedBadge";
import { EmojiPicker } from "./EmojiPicker";
import { MusicClipEditor } from "./MusicClipEditor";
import { fileToWebpIfNeeded, getImageDimensions } from "../utils/media";
import { insertTextAtSelection } from "../utils/textarea";
import type { MediaItem as UploadedMediaItem, PostMusic as UploadedPostMusic } from "../types/media";

type Props = {
  onCreated?: () => void;
};

type HashtagSuggestion = { id: number; name: string };
type UserSuggestion = {
  id: string;
  username: string;
  full_name: string;
  is_verified?: boolean;
  avatar_url?: string;
  bio?: string;
};

const extractHashtags = (text: string, ignoredStarts?: Set<number>) => {
  const regex = /#([\p{L}\p{N}_-]+)/gu;
  const unique = new Set<string>();
  for (const m of text.matchAll(regex)) {
    const start = m.index ?? -1;
    if (ignoredStarts && ignoredStarts.has(start)) continue;
    const word = m[1]?.toLowerCase();
    if (word) unique.add(word);
  }
  return Array.from(unique);
};

const emailLike = /@[^@\s]+\.[A-Za-z]{2,}$/;

type MediaItem = {
  id: string;
  file: File;
  previewUrl: string;
  status: "preparing" | "uploading" | "uploaded" | "error";
  width?: number;
  height?: number;
  remoteUrl?: string;
  remoteKey?: string;
  error?: string;
};

type MusicSelection = {
  source: "upload";
  title: string;
  artist?: string;
  coverUrl?: string;
  audioUrl: string;
  durationSec: number;
  clipStartSec: number;
  clipEndSec: number;
  uploadStatus: "uploading" | "uploaded" | "error";
  remoteKey?: string;
  localPreviewUrl?: string;
  error?: string;
};

const HEIC_MIME_SET = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const MAX_MUSIC_BYTES = 15 * 1024 * 1024;
const MAX_MUSIC_CLIP_SECONDS = 30;
const DEFAULT_MUSIC_DURATION = 30;

const isHeicOrHeifFile = (file: File) => {
  const type = String(file.type || "").toLowerCase();
  if (HEIC_MIME_SET.has(type)) return true;
  if (type.includes("heic") || type.includes("heif")) return true;
  const name = String(file.name || "").trim().toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
};

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutReason: string): Promise<T> => {
  let timer: number | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error(timeoutReason)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }
};

const readAudioDuration = (src: string) =>
  new Promise<number>((resolve, reject) => {
    const audio = new Audio();
    audio.preload = "metadata";
    let settled = false;

    const cleanup = () => {
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("durationchange", onMeta);
      audio.removeEventListener("error", onErr);
      try {
        audio.pause();
      } catch {
        // ignore
      }
      audio.removeAttribute("src");
      audio.load();
    };

    const finish = (value: number, ok: boolean) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (ok) resolve(value);
      else reject(new Error("audio_duration_failed"));
    };

    const onMeta = () => {
      const dur = Number(audio.duration);
      if (!Number.isFinite(dur) || dur <= 0) return;
      finish(Math.max(1, Math.floor(dur)), true);
    };
    const onErr = () => finish(0, false);

    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("durationchange", onMeta);
    audio.addEventListener("error", onErr);
    audio.src = src;
    audio.load();
  });

const normalizeClipRange = (durationSec: number, startSec: number, endSec: number) => {
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? Math.floor(durationSec) : DEFAULT_MUSIC_DURATION;
  const start = Math.max(0, Math.min(duration - 1, Math.floor(startSec || 0)));
  const maxEnd = Math.max(start + 1, duration);
  const requestedEnd = Math.floor(endSec || duration);
  const end = Math.max(start + 1, Math.min(maxEnd, requestedEnd));
  if (end-start > MAX_MUSIC_CLIP_SECONDS) {
    return { duration, start, end: start + MAX_MUSIC_CLIP_SECONDS };
  }
  return { duration, start, end };
};

const highlightInlineHashtags = (
  text: string,
  ignoredHashtagStarts?: Set<number>,
  ignoredMentionStarts?: Set<number>
) => {
  const nodes: JSX.Element[] = [];
  const regex = /[#@][\p{L}\p{N}._-]*/gu;
  let last = 0;
  for (const match of text.matchAll(regex)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start > last) {
      nodes.push(<span key={last}>{text.slice(last, start)}</span>);
    }
    const token = match[0];
    const prev = start === 0 ? "" : text[start - 1];
    const looksLikeEmail = emailLike.test(token);
    if (token.startsWith("#") && !ignoredHashtagStarts?.has(start)) {
      nodes.push(
        <span key={`${start}-#`} className="text-sky-400">
          {token}
        </span>
      );
    } else if (token.startsWith("@") && !looksLikeEmail && !ignoredMentionStarts?.has(start)) {
      nodes.push(
        <span key={`${start}-@`} className="text-purple-400">
          {token}
        </span>
      );
    } else {
      nodes.push(<span key={`${start}-t`}>{token}</span>);
    }
    last = end;
  }
  if (last < text.length) {
    nodes.push(<span key={last}>{text.slice(last)}</span>);
  }
  if (nodes.length === 0) return [<span key="empty">&nbsp;</span>];
  return nodes;
};

const findActiveHashtag = (text: string, cursor: number) => {
  try {
    const beforeCursor = text.slice(0, cursor);
    const hashIndex = beforeCursor.lastIndexOf("#");
    if (hashIndex === -1) return null;
    const afterHash = beforeCursor.slice(hashIndex);
    const match = afterHash.match(/^#([\p{L}\p{N}_-]*)$/u);
    if (!match) return null;
    const query = match[1] || "";
    return { start: hashIndex, end: cursor, query };
  } catch {
    return null;
  }
};

const findActiveMention = (text: string, cursor: number) => {
  try {
    const beforeCursor = text.slice(0, cursor);
    const atIndex = beforeCursor.lastIndexOf("@");
    if (atIndex === -1) return null;
    const afterAt = beforeCursor.slice(atIndex);
    const match = afterAt.match(/^@([\p{L}\p{N}._-]*)$/u);
    if (!match) return null;
    if (emailLike.test(afterAt)) return null;
    const query = match[1] || "";
    return { start: atIndex, end: cursor, query };
  } catch {
    return null;
  }
};

export default function PostComposer({ onCreated }: Props) {
  const token = useAuthStore((s) => s.token);
  const cooldownUntilMs = usePostCooldownStore((s) => s.untilMs);
  const setCooldownUntilMs = usePostCooldownStore((s) => s.setUntilMs);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState(0);
  const [activeTag, setActiveTag] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [activeMention, setActiveMention] = useState<{
    start: number;
    end: number;
    query: string;
  } | null>(null);
  const [suppressedHashtags, setSuppressedHashtags] = useState<Set<number>>(new Set());
  const [suppressedMentions, setSuppressedMentions] = useState<Set<number>>(new Set());
  const suppressNextDetection = useRef(false);
  const [suggestions, setSuggestions] = useState<HashtagSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });
  const [mentionSuggestions, setMentionSuggestions] = useState<UserSuggestion[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionNextOffset, setMentionNextOffset] = useState<number | null>(null);
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const mentionListRef = useRef<HTMLUListElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const emojiButtonRef = useRef<HTMLButtonElement | null>(null);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [music, setMusic] = useState<MusicSelection | null>(null);
  const musicRef = useRef<MusicSelection | null>(null);
  const musicUploadRef = useRef<{ token: string; controller: AbortController } | null>(null);
  const musicInputRef = useRef<HTMLInputElement | null>(null);
  const [musicError, setMusicError] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
  const uploadRef = useRef(new Map<string, { token: string; controller: AbortController }>());
  const mediaRef = useRef<MediaItem[]>([]);
  const MIN_TA_HEIGHT = 72;
  const MAX_MEDIA = 5;

  const remainingMs = Math.max(0, cooldownUntilMs - nowMs);
  const remainingSec = Math.ceil(remainingMs / 1000);
  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  useEffect(() => {
    if (cooldownUntilMs <= Date.now()) return;
    const id = window.setInterval(() => {
      const n = Date.now();
      setNowMs(n);
      if (n >= cooldownUntilMs) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldownUntilMs]);

  useEffect(() => {
    mediaRef.current = media;
  }, [media]);

  useEffect(() => {
    musicRef.current = music;
  }, [music]);

  useEffect(() => {
    return () => {
      uploadRef.current.forEach((v) => v.controller.abort());
      mediaRef.current.forEach((m) => URL.revokeObjectURL(m.previewUrl));
      if (musicUploadRef.current) {
        musicUploadRef.current.controller.abort();
        musicUploadRef.current = null;
      }
      if (musicRef.current?.localPreviewUrl) {
        URL.revokeObjectURL(musicRef.current.localPreviewUrl);
      }
    };
  }, []);

  useEffect(() => {
    if (!previewId) setEditing(false);
  }, [previewId]);

  useEffect(() => {
    if (!previewId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewId]);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.max(ta.scrollHeight, MIN_TA_HEIGHT);
    ta.style.height = `${next}px`;
  };

  useEffect(() => {
    if (suppressNextDetection.current) {
      suppressNextDetection.current = false;
      return;
    }
    const tag = findActiveHashtag(content, cursor);
    const mention = findActiveMention(content, cursor);
    if (!tag || suppressedHashtags.has(tag.start)) {
      setActiveTag(null);
      setSuggestionsOpen(false);
    } else {
      setActiveTag(tag);
    }
    if (!mention || suppressedMentions.has(mention.start)) {
      setActiveMention(null);
      setMentionOpen(false);
    } else {
      setActiveMention(mention);
    }
  }, [content, cursor]);

  useEffect(() => {
    if (!activeTag) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    let cancelled = false;
    setSuggestionsLoading(true);
    const t = setTimeout(async () => {
      try {
        let res: any[] = [];
        if (activeTag.query.trim() === "") {
          res = await api.popularHashtags(8);
        } else {
          res = await api.searchHashtags(activeTag.query, 8);
        }
        if (!cancelled) {
          setSuggestions(Array.isArray(res) ? res : []);
          setSuggestionsOpen(true);
        }
      } catch {
        if (!cancelled) {
          setSuggestions([]);
          setSuggestionsOpen(false);
        }
      } finally {
        if (!cancelled) setSuggestionsLoading(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeTag?.query]);

  useEffect(() => {
    if (!activeMention) {
      setMentionSuggestions([]);
      setMentionOpen(false);
      setMentionNextOffset(null);
      return;
    }
    let cancelled = false;
    const fetchPage = async (offset = 0, append = false) => {
      setMentionLoading(true);
      try {
        const { items, nextOffset } = await api.searchUsersPaged(activeMention.query, 8, offset);
        if (cancelled) return;
        setMentionNextOffset(nextOffset);
        setMentionSuggestions((prev) => {
          const seen = new Set((append ? prev : []).map((u) => u.id));
          const base = append ? [...prev] : [];
          items.forEach((u) => {
            if (!seen.has(u.id)) {
              base.push(u);
              seen.add(u.id);
            }
          });
          return base;
        });
        setMentionOpen(true);
      } catch {
        if (!cancelled) {
          setMentionSuggestions([]);
          setMentionOpen(false);
          setMentionNextOffset(null);
        }
      } finally {
        if (!cancelled) setMentionLoading(false);
      }
    };
    fetchPage(0, false);
    return () => {
      cancelled = true;
    };
  }, [activeMention?.query]);

  const updateOverlayPos = (start: number, symbol: string, setter: (pos: { top: number; left: number }) => void) => {
    const ta = textareaRef.current;
    const mirror = mirrorRef.current;
    if (!ta || !mirror) return;
    const style = window.getComputedStyle(ta);
    mirror.style.position = "fixed";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordBreak = "break-word";
    mirror.style.font = style.font;
    mirror.style.lineHeight = style.lineHeight;
    mirror.style.padding = style.padding;
    mirror.style.border = style.border;
    mirror.style.width = `${ta.clientWidth}px`;
    mirror.style.left = `${ta.getBoundingClientRect().left}px`;
    mirror.style.top = `${ta.getBoundingClientRect().top}px`;
    mirror.textContent = content.slice(0, start);
    const marker = document.createElement("span");
    marker.textContent = symbol;
    mirror.appendChild(marker);
    const after = document.createTextNode(content.slice(start + 1));
    mirror.appendChild(after);
    document.body.appendChild(mirror);
    const rect = marker.getBoundingClientRect();
    setter({ top: rect.bottom + 6, left: rect.left });
    mirror.textContent = "";
  };

  useLayoutEffect(() => {
    if (!suggestionsOpen || !activeTag) return;
    const update = () => updateOverlayPos(activeTag.start, "#", setDropdownPos);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [suggestionsOpen, activeTag, content]);

  useLayoutEffect(() => {
    if (!mentionOpen || !activeMention) return;
    const update = () => updateOverlayPos(activeMention.start, "@", setMentionPos);
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [mentionOpen, activeMention, content]);

  useEffect(() => {
    autoResize();
  }, [content]);

  const replaceActiveHashtag = (name: string) => {
    if (!activeTag) return;
    setSuggestionsOpen(false);
    setActiveTag(null);
    setSuppressedHashtags((prev) => {
      const next = new Set(prev);
      next.delete(activeTag.start);
      return next;
    });
    suppressNextDetection.current = true;
    setContent((prev) => {
      const before = prev.slice(0, activeTag.start);
      const after = prev.slice(activeTag.end);
      return `${before}#${name}${after}`;
    });
    const pos = activeTag.start + name.length + 1;
    setCursor(pos);
  };

  const replaceActiveMention = (username: string) => {
    if (!activeMention) return;
    setMentionOpen(false);
    setActiveMention(null);
    suppressNextDetection.current = true;
    setContent((prev) => {
      const before = prev.slice(0, activeMention.start);
      const after = prev.slice(activeMention.end);
      return `${before}@${username} ${after}`;
    });
    const pos = activeMention.start + username.length + 2;
    setCursor(pos);
  };

  const insertEmoji = (emoji: string) => {
    const ta = textareaRef.current;
    const currentValue = ta?.value ?? content;
    const fallback = Math.min(cursor, currentValue.length);
    const selectionStart = ta?.selectionStart ?? fallback;
    const selectionEnd = ta?.selectionEnd ?? fallback;
    const { nextValue, caret } = insertTextAtSelection(currentValue, emoji, selectionStart, selectionEnd);

    suppressNextDetection.current = true;
    setSuggestionsOpen(false);
    setMentionOpen(false);
    setActiveTag(null);
    setActiveMention(null);
    setContent(nextValue);
    setCursor(caret);
    setEmojiOpen(false);

    requestAnimationFrame(() => {
      const input = textareaRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(caret, caret);
      autoResize();
    });
  };

  const startUpload = async (targets: { id: string; file: File; oldKey?: string }[]) => {
    if (targets.length === 0) return;

    if (!token) {
      setMedia((prev) =>
        prev.map((m) =>
          targets.some((t) => t.id === m.id)
            ? { ...m, status: "error", error: "Войдите в аккаунт, чтобы загружать медиа" }
            : m
        )
      );
      return;
    }

    const MAX_BYTES = 5 * 1024 * 1024;

    // Abort any previous in-flight uploads for these items and mark them as preparing.
    const uploadTokenByID = new Map<string, string>();
    targets.forEach((t) => {
      const prev = uploadRef.current.get(t.id);
      if (prev) prev.controller.abort();
      const controller = new AbortController();
      const uploadToken = crypto.randomUUID();
      uploadRef.current.set(t.id, { token: uploadToken, controller });
      uploadTokenByID.set(t.id, uploadToken);
    });

    setMedia((prev) =>
      prev.map((m) =>
        uploadTokenByID.has(m.id)
          ? {
              ...m,
              status: "preparing",
              error: undefined,
              remoteUrl: undefined,
              remoteKey: undefined,
              width: undefined,
              height: undefined,
            }
          : m
      )
    );

    const prepared = await Promise.all(
      targets.map(async (t) => {
        const entry = uploadRef.current.get(t.id);
        if (!entry) return { id: t.id, ok: false as const, reason: "canceled" };
        if (entry.token !== uploadTokenByID.get(t.id)) return { id: t.id, ok: false as const, reason: "stale" };
        if (entry.controller.signal.aborted) return { id: t.id, ok: false as const, reason: "canceled" };

        try {
          const f = await fileToWebpIfNeeded(t.file);
          if (entry.controller.signal.aborted) return { id: t.id, ok: false as const, reason: "canceled" };
          if (isHeicOrHeifFile(f)) throw new Error("unsupported_heic");
          if (!f.type.startsWith("image/") || f.type === "image/svg+xml") {
            throw new Error("unsupported_image_type");
          }
          if (f.size > MAX_BYTES) throw new Error("file_too_large");
          const { width, height } = await withTimeout(
            getImageDimensions(f),
            4000,
            "image_decode_timeout"
          );
          if (entry.controller.signal.aborted) return { id: t.id, ok: false as const, reason: "canceled" };
          return { id: t.id, ok: true as const, file: f, width, height, oldKey: t.oldKey };
        } catch (e: any) {
          const msg = e?.message || "prepare_failed";
          return { id: t.id, ok: false as const, reason: msg };
        }
      })
    );

    // Apply preparation results to state (dimensions + potentially converted file).
    setMedia((prev) =>
      prev.map((m) => {
        const p = prepared.find((x) => x.id === m.id);
        if (!p) return m;

        if (!p.ok) {
          if (p.reason === "canceled" || p.reason === "stale") return m;
          const current = uploadRef.current.get(m.id);
          if (current && current.token === uploadTokenByID.get(m.id)) {
            uploadRef.current.delete(m.id);
          }
          return {
            ...m,
            status: "error",
            error:
              p.reason === "file_too_large"
                ? "Файл слишком большой (максимум 5MB)"
                : p.reason === "unsupported_heic"
                  ? "Формат HEIC/HEIF не поддерживается. Выберите JPG, PNG, WebP или GIF."
                : p.reason === "image_decode_timeout" || p.reason === "image_load_failed"
                  ? "Формат изображения не поддерживается. Выберите JPG, PNG, WebP или GIF."
                : p.reason === "unsupported_image_type"
                  ? "Поддерживаются только JPG, PNG, WebP или GIF."
                  : "Не удалось подготовить файл",
          };
        }

        const entry = uploadRef.current.get(m.id);
        if (!entry || entry.token !== uploadTokenByID.get(m.id)) return m; // stale

        return {
          ...m,
          file: p.file,
          width: p.width,
          height: p.height,
        };
      })
    );

    const okPrepared = prepared.filter((p): p is Extract<(typeof prepared)[number], { ok: true }> => (p as any).ok);
    if (okPrepared.length === 0) return;

    let presigned: Awaited<ReturnType<typeof api.presignMedia>>;
    try {
      presigned = await api.presignMedia(
        okPrepared.map((p) => ({ content_type: p.file.type, size_bytes: p.file.size })),
        "post",
        token
      );
    } catch (err: any) {
      const retry = Number(err?.retry_after_seconds);
      const msg =
        Number.isFinite(retry) && retry > 0
          ? `Слишком часто. Попробуйте через ${retry} сек.`
          : err?.message?.includes("Failed to fetch")
            ? "Не удалось загрузить медиа (возможен CORS на хранилище)"
            : err?.message || "Не удалось подготовить загрузку";

      setMedia((prev) =>
        prev.map((m) =>
          uploadTokenByID.has(m.id)
            ? {
                ...m,
                status: "error",
                error: msg,
              }
            : m
        )
      );
      okPrepared.forEach((p) => uploadRef.current.delete(p.id));
      return;
    }

    if (presigned.length !== okPrepared.length) {
      setMedia((prev) =>
        prev.map((m) =>
          uploadTokenByID.has(m.id)
            ? { ...m, status: "error", error: "Не удалось подготовить загрузку" }
            : m
        )
      );
      okPrepared.forEach((p) => uploadRef.current.delete(p.id));
      return;
    }

    const idsToUpload = okPrepared.map((p) => p.id);
    setMedia((prev) => prev.map((m) => (idsToUpload.includes(m.id) ? { ...m, status: "uploading" } : m)));

    const results = await Promise.all(
      okPrepared.map(async (p, idx) => {
        const entry = uploadRef.current.get(p.id);
        if (!entry) return { id: p.id, ok: false as const, error: new Error("canceled") };
        if (entry.token !== uploadTokenByID.get(p.id)) return { id: p.id, ok: false as const, error: new Error("stale") };
        try {
          await api.uploadPresignedPut(presigned[idx], p.file, entry.controller.signal);
          return { id: p.id, ok: true as const, url: presigned[idx].url, key: presigned[idx].key, oldKey: p.oldKey };
        } catch (e: any) {
          return { id: p.id, ok: false as const, error: e };
        }
      })
    );

    results.forEach((r) => {
      const entry = uploadRef.current.get(r.id);
      if (!entry || entry.token !== uploadTokenByID.get(r.id)) return; // stale/canceled

      if (r.ok) {
        setMedia((prev) =>
          prev.map((m) =>
            m.id === r.id
              ? {
                  ...m,
                  status: "uploaded",
                  remoteUrl: r.url,
                  remoteKey: r.key,
                  error: undefined,
                }
              : m
          )
        );
        uploadRef.current.delete(r.id);
        if (r.oldKey && r.oldKey !== r.key) api.deleteMedia([r.oldKey], "post", token).catch(() => {});
        return;
      }

      const err: any = r.error;
      const canceled =
        err?.name === "AbortError" ||
        err?.message === "canceled" ||
        err?.message === "stale";
      if (!canceled) {
        setMedia((prev) =>
          prev.map((m) => (m.id === r.id ? { ...m, status: "error", error: "Не удалось загрузить медиа" } : m))
        );
      }
      uploadRef.current.delete(r.id);
    });
  };

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const valid: MediaItem[] = [];
    const allowed = /^image\//i;
    const currentCount = media.length;
    let rejected = false;
    let rejectedHeic = false;
    const MAX_BYTES = 5 * 1024 * 1024;

    for (const f of incoming) {
      if (isHeicOrHeifFile(f)) {
        rejected = true;
        rejectedHeic = true;
        continue;
      }
      if (!allowed.test(f.type) || f.type === "image/svg+xml") {
        rejected = true;
        continue;
      }
      if (f.size > MAX_BYTES) {
        rejected = true;
        continue;
      }
      if (currentCount + valid.length >= MAX_MEDIA) {
        rejected = true;
        break;
      }
      valid.push({
        id: crypto.randomUUID(),
        file: f,
        previewUrl: URL.createObjectURL(f),
        status: "preparing",
      });
    }

    if (rejected) {
      setMediaError(
        rejectedHeic
          ? "Формат HEIC/HEIF не поддерживается. Выберите JPG, PNG, WebP или GIF."
          : "Можно добавить только изображения до 5MB (максимум 5 вложений)"
      );
      setTimeout(() => setMediaError(""), 3000);
    }

    if (valid.length) {
      setMedia((prev) => [...prev, ...valid]);
      startUpload(valid.map((m) => ({ id: m.id, file: m.file })));
    }
  };

  const removeMedia = (id: string) => {
    setMedia((prev) => {
      const next = prev.filter((m) => m.id !== id);
      const removed = prev.find((m) => m.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        const inflight = uploadRef.current.get(id);
        if (inflight) {
          inflight.controller.abort();
          uploadRef.current.delete(id);
        }
        if (removed.status === "uploaded" && removed.remoteKey && token) {
          api.deleteMedia([removed.remoteKey], "post", token).catch(() => {});
        }
      }
      return next;
    });
    setPreviewId((prev) => (prev === id ? null : prev));
  };

  const clearMusicSelection = (opts?: { deleteRemote?: boolean }) => {
    const prev = musicRef.current;
    if (musicUploadRef.current) {
      musicUploadRef.current.controller.abort();
      musicUploadRef.current = null;
    }
    if (!prev) {
      setMusic(null);
      return;
    }
    if (prev.localPreviewUrl) {
      URL.revokeObjectURL(prev.localPreviewUrl);
    }
    if (opts?.deleteRemote && prev.remoteKey && token) {
      api.deleteMedia([prev.remoteKey], "post_music", token).catch(() => {});
    }
    setMusic(null);
    setMusicError("");
  };

  const uploadMusicFile = async (file: File) => {
    if (!token) {
      setMusicError("Войдите в аккаунт, чтобы добавить музыку");
      return;
    }
    const mime = String(file.type || "").toLowerCase();
    if (!mime.startsWith("audio/")) {
      setMusicError("Поддерживаются только аудио-файлы");
      return;
    }
    if (file.size <= 0 || file.size > MAX_MUSIC_BYTES) {
      setMusicError("Аудио должно быть до 15MB");
      return;
    }

    clearMusicSelection({ deleteRemote: true });
    const localPreviewUrl = URL.createObjectURL(file);

    let durationSec = DEFAULT_MUSIC_DURATION;
    try {
      durationSec = await withTimeout(
        readAudioDuration(localPreviewUrl),
        5000,
        "audio_duration_timeout"
      );
    } catch {
      durationSec = DEFAULT_MUSIC_DURATION;
    }

    const initialClip = normalizeClipRange(
      durationSec,
      0,
      Math.min(durationSec, MAX_MUSIC_CLIP_SECONDS)
    );

    setMusic({
      source: "upload",
      title: file.name || "Music",
      audioUrl: "",
      durationSec: initialClip.duration,
      clipStartSec: initialClip.start,
      clipEndSec: initialClip.end,
      uploadStatus: "uploading",
      localPreviewUrl,
    });
    setMusicError("");

    const uploadToken = crypto.randomUUID();
    const controller = new AbortController();
    musicUploadRef.current = { token: uploadToken, controller };

    try {
      const presigned = await api.presignMedia(
        [{ content_type: file.type, size_bytes: file.size }],
        "post_music",
        token
      );
      const target = presigned[0];
      if (!target) throw new Error("music_presign_failed");

      if (musicUploadRef.current?.token !== uploadToken) return;

      await api.uploadPresignedPut(target, file, controller.signal);
      if (musicUploadRef.current?.token !== uploadToken) return;

      setMusic((prev) => {
        if (!prev || prev.localPreviewUrl !== localPreviewUrl) return prev;
        return {
          ...prev,
          title: file.name || prev.title,
          audioUrl: target.url,
          remoteKey: target.key,
          uploadStatus: "uploaded",
          error: undefined,
        };
      });
      musicUploadRef.current = null;
    } catch (e: any) {
      const canceled =
        e?.name === "AbortError" ||
        e?.message === "canceled" ||
        e?.message === "stale";
      if (canceled) return;

      if (musicUploadRef.current?.token === uploadToken) {
        musicUploadRef.current = null;
      }
      setMusic((prev) => {
        if (!prev || prev.localPreviewUrl !== localPreviewUrl) return prev;
        return {
          ...prev,
          uploadStatus: "error",
          error: "Не удалось загрузить аудио",
        };
      });
      setMusicError("Не удалось загрузить аудио");
    }
  };

  const handleMusicFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const first = files[0];
    if (!first) return;
    void uploadMusicFile(first);
  };

  const updateMusicClipRange = useCallback((nextStart: number, nextEnd: number) => {
    setMusic((prev) => {
      if (!prev) return prev;
      const clip = normalizeClipRange(prev.durationSec, nextStart, nextEnd);
      return { ...prev, durationSec: clip.duration, clipStartSec: clip.start, clipEndSec: clip.end };
    });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (remainingSec > 0) return;
    setLoading(true);
    setError("");
    try {
      const tags = extractHashtags(content, suppressedHashtags);
      const selected = mediaRef.current;
      const selectedMusic = musicRef.current;
      if (selected.some((m) => m.status === "preparing" || m.status === "uploading")) {
        throw new Error("uploads_pending");
      }
      if (selected.some((m) => m.status === "error")) {
        throw new Error("uploads_failed");
      }
      if (selectedMusic?.uploadStatus === "uploading") {
        throw new Error("music_upload_pending");
      }
      if (selectedMusic?.uploadStatus === "error") {
        throw new Error("music_upload_failed");
      }

      const uploadedMedia: UploadedMediaItem[] = selected
        .filter((m) => m.status === "uploaded" && m.remoteUrl && m.width && m.height)
        .map((m) => ({
          url: m.remoteUrl as string,
          width: m.width as number,
          height: m.height as number,
        }));

      let musicPayload: UploadedPostMusic | undefined;
      if (selectedMusic && selectedMusic.uploadStatus === "uploaded" && selectedMusic.audioUrl) {
        musicPayload = {
          source: selectedMusic.source,
          title: selectedMusic.title,
          artist: selectedMusic.artist,
          cover_url: selectedMusic.coverUrl,
          audio_url: selectedMusic.audioUrl,
          duration_sec: selectedMusic.durationSec,
          clip_start_sec: selectedMusic.clipStartSec,
          clip_end_sec: selectedMusic.clipEndSec,
        };
      }

      const hasAttachments = uploadedMedia.length > 0 || !!musicPayload;
      await api.createPost({ content, hashtags: tags, media: uploadedMedia, music: musicPayload }, token);
      setCooldownUntilMs(Date.now() + (hasAttachments ? 120 : 60) * 1000);
      setMedia((prev) => {
        prev.forEach((m) => URL.revokeObjectURL(m.previewUrl));
        return [];
      });
      clearMusicSelection();
      setContent("");
      setEmojiOpen(false);
      setSuggestions([]);
      setActiveTag(null);
      setSuppressedHashtags(new Set());
      setSuppressedMentions(new Set());
      onCreated?.();
    } catch (err: any) {
      const retry = Number(err?.retry_after_seconds);
      if (Number.isFinite(retry) && retry > 0) {
        setCooldownUntilMs(Date.now() + retry * 1000);
        setError(`Слишком часто. Попробуйте через ${retry} сек.`);
      } else {
        const msg =
          err?.message === "uploads_pending"
            ? "Дождитесь завершения загрузки медиа"
            : err?.message === "uploads_failed"
              ? "Есть медиа с ошибкой. Удалите или повторите загрузку."
              : err?.message === "music_upload_pending"
                ? "Дождитесь завершения загрузки музыки"
                : err?.message === "music_upload_failed"
                  ? "Исправьте ошибку загрузки музыки или удалите её"
              : err?.message?.includes("Failed to fetch")
                ? "Не удалось создать пост (нет соединения)"
                : err.message || "Не удалось создать пост";
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const previewItem = previewId ? media.find((m) => m.id === previewId) : null;
  const hasPendingUploads = media.some((m) => m.status === "preparing" || m.status === "uploading");
  const hasUploadErrors = media.some((m) => m.status === "error");
  const uploadedCount = media.filter((m) => m.status === "uploaded").length;
  const hasMusicPending = music?.uploadStatus === "uploading";
  const hasMusicError = music?.uploadStatus === "error";
  const musicPreviewSrc = music ? (music.localPreviewUrl || music.audioUrl || "") : "";

  return (
    <form
      onSubmit={submit}
      className="card p-4 md:p-4 space-y-3"
    >
      <div className="flex items-center justify-between text-sm text-white/70">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 rounded-full bg-white/10 items-center justify-center text-lg">🙂</span>
          <span className="font-semibold text-white">Поделиться чем-то новым</span>
        </div>
      </div>
      <ErrorMessage message={mediaError} />
      <ErrorMessage message={musicError} />

      <input
        ref={musicInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => {
          handleMusicFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      {music && (
        <div className="rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-start gap-3">
            {music.coverUrl ? (
              <img
                src={music.coverUrl}
                alt={music.title}
                className="h-12 w-12 rounded-lg object-cover bg-white/10"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="h-12 w-12 rounded-lg bg-white/10 text-white/70 grid place-items-center shrink-0">
                <Music2 className="h-5 w-5" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{music.title}</p>
              <p className="truncate text-xs text-white/60">{music.artist || "Unknown artist"}</p>
              <p className="text-[11px] text-white/45">
                {music.uploadStatus === "uploading"
                  ? "Загрузка..."
                  : music.uploadStatus === "error"
                    ? "Ошибка загрузки"
                    : "Ваш файл"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => clearMusicSelection({ deleteRemote: true })}
              className="h-7 w-7 rounded-full border border-white/15 bg-white/10 text-white/80 hover:bg-white/15"
              aria-label="Удалить музыку"
            >
              <X className="h-4 w-4 mx-auto" />
            </button>
          </div>

          {musicPreviewSrc ? (
            <MusicClipEditor
              src={musicPreviewSrc}
              durationSec={music.durationSec}
              clipStartSec={music.clipStartSec}
              clipEndSec={music.clipEndSec}
              maxClipSec={MAX_MUSIC_CLIP_SECONDS}
              onClipChange={updateMusicClipRange}
            />
          ) : null}
        </div>
      )}

      {media.length > 0 && (
        <div className={`grid gap-2 ${media.length <= 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {media.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => {
                if (m.status === "error") {
                  startUpload([{ id: m.id, file: m.file, oldKey: m.remoteKey }]);
                  return;
                }
                setPreviewId(m.id);
              }}
              className="relative overflow-hidden rounded-xl border border-white/10 bg-black/30 aspect-video group focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
            >
              <img
                src={m.previewUrl}
                alt="preview"
                className="w-full h-full object-cover group-hover:opacity-90 transition"
              />
              {(m.status === "preparing" || m.status === "uploading") && (
                <div className="absolute inset-0 bg-black/55 flex items-center justify-center">
                  <div className="h-6 w-6 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                </div>
              )}
              {m.status === "error" && (
                <div className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-2 px-2">
                  <span className="text-xs text-white/80 text-center">{m.error || "Ошибка загрузки"}</span>
                  <span className="text-[11px] text-white/60">Нажмите, чтобы повторить</span>
                </div>
              )}
              <span className="absolute top-1 right-1 text-xs bg-black/70 text-white px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition">
                Просмотр
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <div className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-3">
          <div className="pointer-events-none whitespace-pre-wrap break-words text-white font-medium relative z-0 min-h-[72px]">
              {content.trim().length === 0 ? (
                <span className="text-white/40">Что нового?</span>
              ) : (
                highlightInlineHashtags(content, suppressedHashtags, suppressedMentions)
              )}
            </div>
          </div>
        <textarea
          className="w-full rounded-xl border-0 bg-transparent px-3 py-3 text-transparent caret-white placeholder:text-transparent focus:border-0 focus:ring-0 focus:outline-none transition absolute inset-0 z-10 resize-none overflow-hidden font-medium"
          rows={3}
          placeholder="Что нового?"
          value={content}
          onChange={(e) => {
            let val = e.target.value;
            const pos = e.target.selectionStart ?? val.length;
            if (pos >= 2 && val[pos - 1] === " " && val[pos - 2] === "#") {
              val = val.slice(0, pos - 2) + val.slice(pos);
              e.target.value = val;
              e.target.selectionStart = pos - 2;
              e.target.selectionEnd = pos - 2;
            }
            setContent(val);
            setCursor(e.target.selectionStart ?? val.length);
            autoResize();
          }}
          ref={textareaRef}
          onSelect={(e) =>
            setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
          }
          onKeyUp={(e) =>
            setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
          }
          onClick={(e) =>
            setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" && activeTag) {
              e.preventDefault();
              const tagText = activeTag.query.trim();
              const finalTag = tagText.length > 0 ? tagText : "";
              const tagToInsert = `#${finalTag}`;
              setContent((prev) => {
                const before = prev.slice(0, activeTag.start);
                const after = prev.slice(activeTag.end);
                return `${before}${tagToInsert} ${after}`;
              });
              const nextPos = activeTag.start + tagToInsert.length + 1;
              setCursor(nextPos);
              setActiveTag(null);
              setSuggestionsOpen(false);
              suppressNextDetection.current = true;
              return;
            }
            if (e.key === "Enter" && activeMention) {
              e.preventDefault();
              const mentionText =
                activeMention.query.trim() || mentionSuggestions[0]?.username || "";
              if (!mentionText) return;
              replaceActiveMention(mentionText);
              return;
            }
          }}
          required
        />
        {suggestionsOpen &&
          createPortal(
            <div
              className="z-[999] overflow-hidden rounded-xl border border-white/10 bg-[#0f1116] shadow-xl"
              style={{
                position: "fixed",
                top: dropdownPos.top,
                left: dropdownPos.left,
                width: 300,
              }}
            >
              <div className="flex items-center justify-between px-3 py-2 text-white/70 text-sm border-b border-white/10">
                <span>Хэштеги</span>
                <button
                  type="button"
                  className="text-white/60 hover:text-white"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSuggestionsOpen(false);
                    setActiveTag(null);
                    setSuppressedHashtags((prev) => {
                      if (!activeTag) return prev;
                      const next = new Set(prev);
                      next.add(activeTag.start);
                      return next;
                    });
                  }}
                >
                  ×
                </button>
              </div>
              {suggestions.length > 0 ? (
                <ul className="max-h-52 overflow-y-auto divide-y divide-white/5 text-sm scrollbar-hide">
                  {suggestions.map((tag) => (
                    <li key={tag.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-white hover:bg-white/5"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          replaceActiveHashtag(tag.name);
                        }}
                      >
                        <span className="text-white/60">#</span>
                        <span className="font-semibold text-sky-400">{tag.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="px-3 py-2 text-sm text-white/60">
                  {suggestionsLoading
                    ? "Поиск..."
                    : `Нажмите Enter, чтобы создать хэштег #${activeTag?.query ?? ""}`}
                </div>
              )}
            </div>,
            document.body
          )}
        {mentionOpen &&
          createPortal(
            <div
              className="z-[999] overflow-hidden rounded-xl border border-white/10 bg-[#0f1116] shadow-xl"
              style={{
                position: "fixed",
                top: mentionPos.top,
                left: mentionPos.left,
                width: 300,
              }}
            >
              <div className="flex items-center justify-between px-3 py-2 text-white/70 text-sm border-b border-white/10">
                <span>Упоминания</span>
                <button
                  type="button"
                  className="text-white/60 hover:text-white"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setMentionOpen(false);
                    setActiveMention(null);
                    setSuppressedMentions((prev) => {
                      if (!activeMention) return prev;
                      const next = new Set(prev);
                      next.add(activeMention.start);
                      return next;
                    });
                  }}
                >
                  ×
                </button>
              </div>
              {mentionSuggestions.length > 0 ? (
                <ul
                  ref={mentionListRef}
                  className="max-h-60 overflow-y-auto divide-y divide-white/5 text-sm scrollbar-hide"
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (
                      mentionNextOffset !== null &&
                      !mentionLoading &&
                      el.scrollTop + el.clientHeight >= el.scrollHeight - 40
                    ) {
                      (async () => {
                        setMentionLoading(true);
                        try {
                          const { items, nextOffset } = await api.searchUsersPaged(
                            activeMention?.query || "",
                            8,
                            mentionNextOffset
                          );
                          setMentionNextOffset(nextOffset);
                          setMentionSuggestions((prev) => {
                            const seen = new Set(prev.map((u) => u.id));
                            const merged = [...prev];
                            items.forEach((u) => {
                              if (!seen.has(u.id)) {
                                merged.push(u);
                                seen.add(u.id);
                              }
                            });
                            return merged;
                          });
                        } finally {
                          setMentionLoading(false);
                        }
                      })();
                    }
                  }}
                >
                  {mentionSuggestions.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-3 px-3 py-2 text-left text-white hover:bg-white/5"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          replaceActiveMention(u.username);
                        }}
                      >
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-sm">
                          {u.avatar_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={u.avatar_url}
                              alt={u.username}
                              className="w-8 h-8 rounded-full object-cover"
                            />
                          ) : (
                          (u.full_name || u.username || "U")[0]?.toUpperCase() || "U"
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate inline-flex items-center gap-[3px]">
                          <span>{u.full_name || u.username}</span>
                          {u.is_verified ? <VerifiedBadge /> : null}
                        </p>
                        <p className="text-white/60 text-sm truncate">@{u.username}</p>
                        {u.bio && <p className="text-white/50 text-xs truncate">{u.bio}</p>}
                      </div>
                    </button>
                  </li>
                ))}
                  {mentionLoading && (
                    <li className="px-3 py-2 text-sm text-white/60">Загрузка...</li>
                  )}
                </ul>
              ) : (
                <div className="px-3 py-2 text-sm text-white/60">
                  {mentionLoading ? "Поиск..." : "Введите имя пользователя"}
                </div>
              )}
            </div>,
            document.body
          )}
        <div
          ref={mirrorRef}
          className="pointer-events-none invisible absolute whitespace-pre-wrap break-words"
          aria-hidden="true"
        />
      </div>
      <ErrorMessage message={error} />
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="flex gap-2 text-white/50 shrink-0">
          <label className="nav-icon shrink-0 bg-white/5 border border-white/10 cursor-pointer">
            <ImageIcon className="w-5 h-5" strokeWidth={1.7} />
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              multiple
              onChange={(e) => {
                handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="nav-icon shrink-0 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/25"
            title="Рисование"
            onClick={() => {
              if (mediaRef.current.length >= MAX_MEDIA) {
                setMediaError("Можно добавить максимум 5 вложений");
                setTimeout(() => setMediaError(""), 3000);
                return;
              }
              setDrawingOpen(true);
            }}
          >
            <Paintbrush className="w-5 h-5" strokeWidth={1.7} />
          </button>
          <button
            ref={emojiButtonRef}
            type="button"
            className={`nav-icon shrink-0 border border-amber-300/35 text-amber-200 ${emojiOpen ? "bg-amber-300/25" : "bg-amber-300/10"} hover:bg-amber-300/20 hover:border-amber-200/45`}
            title="Эмодзи"
            aria-label="Открыть список эмодзи"
            onClick={() => setEmojiOpen((prev) => !prev)}
          >
            <Smile className="w-5 h-5" strokeWidth={1.7} />
          </button>
          <button
            type="button"
            className="nav-icon shrink-0 border border-cyan-300/35 bg-cyan-300/10 text-cyan-200 hover:bg-cyan-300/20 hover:border-cyan-200/45"
            title="Добавить музыку"
            aria-label="Добавить музыку"
            onClick={() => musicInputRef.current?.click()}
          >
            <Music2 className="w-5 h-5" strokeWidth={1.7} />
          </button>
        </div>
        <div className="flex flex-col items-end gap-1 ml-auto">
          {hasPendingUploads && (
            <span className="text-xs text-white/50">
              Загрузка медиа: {uploadedCount}/{media.length}
            </span>
          )}
          {hasMusicPending && (
            <span className="text-xs text-white/50">
              Загрузка музыки...
            </span>
          )}
          {hasMusicError && (
            <span className="text-xs text-red-300/90">
              Исправьте ошибку музыки перед публикацией
            </span>
          )}
          {remainingSec > 0 && (
            <span className="text-xs text-white/50">
              Можно публиковать через {formatTimer(remainingSec)}
            </span>
          )}
          <button
            type="submit"
            disabled={loading || !content.trim() || remainingSec > 0 || hasPendingUploads || hasUploadErrors || hasMusicPending || hasMusicError}
            className="rounded-full px-4 py-2 font-semibold text-black bg-white hover:bg-gray-200 disabled:opacity-60"
          >
            {loading ? "Публикуем..." : "Опубликовать"}
          </button>
        </div>
      </div>
      <EmojiPicker
        open={emojiOpen}
        anchorRef={emojiButtonRef}
        onClose={() => setEmojiOpen(false)}
        onSelect={insertEmoji}
      />

      {previewItem &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setPreviewId(null)}
          >
            <div
              className="relative bg-black border border-white/10 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {editing ? (
                <FabricImageEditor
                  src={previewItem.previewUrl}
                  fileName={previewItem.file.name}
                  onCancel={() => setEditing(false)}
                  onSave={(nextFile) => {
                    const current = mediaRef.current.find((m) => m.id === previewItem.id);
                    if (!current) {
                      setEditing(false);
                      return;
                    }
                    const oldUrl = current.previewUrl;
                    const oldKey = current.remoteKey;
                    const nextUrl = URL.createObjectURL(nextFile);
                    setMedia((prev) =>
                      prev.map((m) =>
                        m.id === previewItem.id
                          ? { ...m, file: nextFile, previewUrl: nextUrl, status: "preparing", error: undefined }
                          : m
                      )
                    );
                    window.setTimeout(() => URL.revokeObjectURL(oldUrl), 0);
                    setEditing(false);
                    startUpload([{ id: previewItem.id, file: nextFile, oldKey }]);
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
                  <div className="relative inline-block max-w-full">
                    <img
                      src={previewItem.previewUrl}
                      alt="preview"
                      className="max-h-[76vh] max-w-full object-contain rounded-xl"
                    />
                    <div className="absolute top-2 right-2 flex items-center gap-2">
                      <button
                        type="button"
                        title="Редактировать"
                        className="w-10 h-10 rounded-full bg-black/70 border border-white/15 backdrop-blur flex items-center justify-center hover:bg-black/80"
                        onClick={() => setEditing(true)}
                      >
                        <Edit3 className="w-5 h-5 text-sky-400" />
                      </button>
                      <button
                        type="button"
                        title="Удалить"
                        className="w-10 h-10 rounded-full bg-black/70 border border-white/15 backdrop-blur flex items-center justify-center hover:bg-black/80"
                        onClick={() => removeMedia(previewItem.id)}
                      >
                        <Trash2 className="w-5 h-5 text-red-400" />
                      </button>
                      <button
                        type="button"
                        title="Закрыть"
                        className="w-10 h-10 rounded-full bg-black/70 border border-white/15 backdrop-blur flex items-center justify-center hover:bg-black/80"
                        onClick={() => setPreviewId(null)}
                      >
                        <X className="w-6 h-6 text-white" />
                      </button>
                    </div>
                    <div className="absolute bottom-2 right-2 text-xs bg-black/70 text-white/80 px-2 py-1 rounded-full border border-white/10">
                      {media.findIndex((m) => m.id === previewItem.id) + 1} / {media.length}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}

      {drawingOpen && (
        <DrawingModal
          onClose={() => setDrawingOpen(false)}
          onSave={(file) => {
            if (mediaRef.current.length >= MAX_MEDIA) {
              setMediaError("Можно добавить максимум 5 вложений");
              setTimeout(() => setMediaError(""), 3000);
              return;
            }
            const item: MediaItem = {
              id: crypto.randomUUID(),
              file,
              previewUrl: URL.createObjectURL(file),
              status: "preparing",
            };
            setMedia((prev) => [...prev, item]);
            startUpload([{ id: item.id, file: item.file }]);
            setDrawingOpen(false);
          }}
        />
      )}
    </form>
  );
}

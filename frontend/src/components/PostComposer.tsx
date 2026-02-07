import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { usePostCooldownStore } from "../store/postCooldown";
import { Image as ImageIcon, X, Edit3, Trash2, Paintbrush } from "lucide-react";
import { DrawingModal } from "./DrawingModal";
import { ErrorMessage } from "./ErrorMessage";
import FabricImageEditor from "./FabricImageEditor";
import { fileToWebpIfNeeded } from "../utils/media";
import type { MediaItem as UploadedMediaItem } from "../types/media";

type Props = {
  onCreated?: () => void;
};

type HashtagSuggestion = { id: number; name: string };
type UserSuggestion = {
  id: string;
  username: string;
  full_name: string;
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
  url: string;
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
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [mediaError, setMediaError] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [drawingOpen, setDrawingOpen] = useState(false);
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
    return () => {
      mediaRef.current.forEach((m) => URL.revokeObjectURL(m.url));
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

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList) return;
    const incoming = Array.from(fileList);
    const valid: MediaItem[] = [];
    const allowed = /^image\//i;
    const currentCount = media.length;
    let rejected = false;

    for (const f of incoming) {
      if (!allowed.test(f.type) || f.type === "image/svg+xml") {
        rejected = true;
        continue;
      }
      if (currentCount + valid.length >= MAX_MEDIA) {
        rejected = true;
        break;
      }
      valid.push({ id: crypto.randomUUID(), file: f, url: URL.createObjectURL(f) });
    }

    if (rejected) {
      setMediaError("Можно добавить только изображения (максимум 5 вложений)");
      setTimeout(() => setMediaError(""), 3000);
    }

    if (valid.length) {
      setMedia((prev) => [...prev, ...valid]);
    }
  };

  const removeMedia = (id: string) => {
    setMedia((prev) => {
      const next = prev.filter((m) => m.id !== id);
      const removed = prev.find((m) => m.id === id);
      if (removed) URL.revokeObjectURL(removed.url);
      return next;
    });
    setPreviewId((prev) => (prev === id ? null : prev));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    if (remainingSec > 0) return;
    setLoading(true);
    setError("");
    try {
      const tags = extractHashtags(content, suppressedHashtags);
      const selected = mediaRef.current;
      let uploadedMedia: UploadedMediaItem[] = [];
      if (selected.length > 0) {
        const files = await Promise.all(selected.map((m) => fileToWebpIfNeeded(m.file)));
        uploadedMedia = await api.uploadMedia(files, "post", token);
      }
      const hasMedia = uploadedMedia.length > 0;
      await api.createPost({ content, hashtags: tags, media: uploadedMedia }, token);
      setCooldownUntilMs(Date.now() + (hasMedia ? 120 : 60) * 1000);
      setMedia((prev) => {
        prev.forEach((m) => URL.revokeObjectURL(m.url));
        return [];
      });
      setContent("");
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
        setError(err.message || "Не удалось создать пост");
      }
    } finally {
      setLoading(false);
    }
  };

  const previewItem = previewId ? media.find((m) => m.id === previewId) : null;

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
      {media.length > 0 && (
        <div className={`grid gap-2 ${media.length <= 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {media.map((m) => (
            <button
              type="button"
              key={m.id}
              onClick={() => setPreviewId(m.id)}
              className="relative overflow-hidden rounded-xl border border-white/10 bg-black/30 aspect-video group"
            >
              <img
                src={m.url}
                alt="preview"
                className="w-full h-full object-cover group-hover:opacity-90 transition"
              />
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
                        <p className="font-semibold truncate">{u.full_name || u.username}</p>
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
      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-white/50">
          <label className="nav-icon bg-white/5 border border-white/10 cursor-pointer">
            <ImageIcon className="w-5 h-5" strokeWidth={1.7} />
            <input
              type="file"
              accept="image/*,image/gif"
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
            className="nav-icon bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/25"
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
        </div>
        <div className="flex flex-col items-end gap-1">
          {remainingSec > 0 && (
            <span className="text-xs text-white/50">
              Можно публиковать через {formatTimer(remainingSec)}
            </span>
          )}
          <button
            type="submit"
            disabled={loading || !content.trim() || remainingSec > 0}
            className="rounded-full px-4 py-2 font-semibold text-black bg-white hover:bg-gray-200 disabled:opacity-60"
          >
            {loading ? "Публикуем..." : "Опубликовать"}
          </button>
        </div>
      </div>

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
                  src={previewItem.url}
                  fileName={previewItem.file.name}
                  onCancel={() => setEditing(false)}
                  onSave={(nextFile) => {
                    const current = mediaRef.current.find((m) => m.id === previewItem.id);
                    if (!current) {
                      setEditing(false);
                      return;
                    }
                    const oldUrl = current.url;
                    const nextUrl = URL.createObjectURL(nextFile);
                    setMedia((prev) =>
                      prev.map((m) => (m.id === previewItem.id ? { ...m, file: nextFile, url: nextUrl } : m))
                    );
                    window.setTimeout(() => URL.revokeObjectURL(oldUrl), 0);
                    setEditing(false);
                  }}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
                  <div className="relative inline-block max-w-full">
                    <img
                      src={previewItem.url}
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
              url: URL.createObjectURL(file),
            };
            setMedia((prev) => [...prev, item]);
            setDrawingOpen(false);
          }}
        />
      )}
    </form>
  );
}

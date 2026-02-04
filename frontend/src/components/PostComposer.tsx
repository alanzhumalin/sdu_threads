import { FormEvent, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { Image as ImageIcon } from "lucide-react";

type Props = {
  onCreated?: () => void;
};

type HashtagSuggestion = { id: number; name: string };
type UserSuggestion = {
  id: string;
  username: string;
  full_name: string;
  avatar_url?: string;
  major?: string;
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
  const MIN_TA_HEIGHT = 72;

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setLoading(true);
    setError("");
    try {
      const tags = extractHashtags(content, suppressedHashtags);
      await api.createPost({ content, hashtags: tags }, token);
      setContent("");
      setSuggestions([]);
      setActiveTag(null);
      setSuppressedHashtags(new Set());
      setSuppressedMentions(new Set());
      onCreated?.();
    } catch (err: any) {
      setError(err.message || "Не удалось создать пост");
    } finally {
      setLoading(false);
    }
  };

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
                          {u.major && <p className="text-white/50 text-xs truncate">{u.major}</p>}
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
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="flex items-center justify-between">
        <div className="flex gap-2 text-white/50">
          <button type="button" className="nav-icon bg-white/5 border border-white/10">
            <ImageIcon className="w-5 h-5" strokeWidth={1.7} />
          </button>
        </div>
        <button
          type="submit"
          disabled={loading || !content.trim()}
          className="rounded-full px-4 py-2 font-semibold text-black bg-white hover:bg-gray-200 disabled:opacity-60"
        >
          {loading ? "Публикуем..." : "Опубликовать"}
        </button>
      </div>
    </form>
  );
}

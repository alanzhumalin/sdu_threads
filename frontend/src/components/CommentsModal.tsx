import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { X, Heart, Paperclip, SendHorizontal, MessageCircle, Eye } from "lucide-react";
import { highlightHashtags } from "../utils/text";

type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  username: string;
  full_name?: string;
  body: string;
  created_at: string;
  liked_by_me: boolean;
  like_count: number;
  replies_count: number;
  reply_to_comment_id?: string;
  replies?: Comment[];
  reply_to_full_name?: string;
  reply_to_username?: string;
  mentions?: string[];
  hashtags?: string[];
};

export type PostMeta = {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  content: string;
  created_at: string;
  media_url?: string;
  like_count: number;
  liked_by_me: boolean;
  view_count: number;
  comment_count?: number;
  mentions?: string[];
  hashtags?: string[];
  is_subscribed?: boolean;
  is_me?: boolean;
};

type Props = {
  post: PostMeta;
  onClose: () => void;
  onUpdatePost?: (id: string, patch: Partial<PostMeta>) => void;
  focusCommentId?: string;
};

const PAGE = 20;
const punctOrSpace = /[\s.,!?;:()[\]{}"']/;
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

const timeAgo = (iso: string) => {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (sec < 45) return "только что";
  if (min < 2) return "минуту назад";
  if (min < 5) return `${min} минуты назад`;
  if (min < 60) return `${min} мин назад`;
  if (hour < 2) return "час назад";
  if (hour < 5) return `${hour} часа назад`;
  if (hour < 24) return `${hour} ч назад`;
  if (day === 1) return "вчера";
  if (day < 7) return `${day} дн назад`;
  return date.toLocaleString();
};

export function CommentsModal({ post, onClose, onUpdatePost, focusCommentId }: Props) {
  const token = useAuthStore((s) => s.token);
  const [postMeta, setPostMeta] = useState(post);
  const [comments, setComments] = useState<Comment[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [replyMode, setReplyMode] = useState(false);
  const [replies, setReplies] = useState<
    Record<string, { items: Comment[]; offset: number; total: number | null; loading: boolean }>
  >({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const commentRefs = useRef<Record<string, HTMLElement | null>>({});
  const [cursor, setCursor] = useState(0);
  const [activeTag, setActiveTag] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeMention, setActiveMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const suppressNextDetection = useRef(false);
  const [suggestions, setSuggestions] = useState<{ id: number; name: string }[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [mentionSuggestions, setMentionSuggestions] = useState<
    { id: string; username: string; full_name: string; avatar_url?: string; major?: string }[]
  >([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionNextOffset, setMentionNextOffset] = useState<number | null>(null);
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const mentionListRef = useRef<HTMLUListElement | null>(null);
  const [suppressedHashtags, setSuppressedHashtags] = useState<Set<number>>(new Set());
  const [suppressedMentions, setSuppressedMentions] = useState<Set<number>>(new Set());
  const MIN_TA_HEIGHT = 64;

  const toSet = (arr?: string[]) => (arr && arr.length > 0 ? new Set(arr.map((m) => m.toLowerCase())) : undefined);

  const autoResize = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const next = Math.max(ta.scrollHeight, MIN_TA_HEIGHT);
    ta.style.height = `${next}px`;
  };

  useEffect(() => {
    autoResize();
  }, [body]);

  const load = async (append = false) => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await api.listComments(post.id, PAGE, append ? offset : 0, token);
      setTotal((t) => (t === null ? data.length : t)); // rough total; server не отдаёт total
      setComments((prev) => (append ? [...prev, ...data] : data));
      setReplies((prev) => {
        const next = { ...prev };
        (append ? data : data).forEach((c) => {
          const total = typeof c.replies_count === "number" ? c.replies_count : c.replies?.length ?? 0;
          next[c.id] = {
            items: c.replies || [],
            offset: c.replies?.length || 0,
            total,
            loading: false,
          };
        });
        return next;
      });
      if (append) setOffset((o) => o + data.length);
      else setOffset(data.length);
      setError("");
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить комментарии");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  useEffect(() => {
    setPostMeta(post);
    setReplyMode(false);
    setReplyTo(null);
    setBody("");
    setActiveTag(null);
    setActiveMention(null);
    setSuppressedHashtags(new Set());
    setSuppressedMentions(new Set());
  }, [post]);

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
    setBody((prev) => {
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
    setBody((prev) => {
      const before = prev.slice(0, activeMention.start);
      const after = prev.slice(activeMention.end);
      return `${before}@${username} ${after}`;
    });
    const pos = activeMention.start + username.length + 2;
    setCursor(pos);
  };

  useEffect(() => {
    if (suppressNextDetection.current) {
      suppressNextDetection.current = false;
      return;
    }
    const tag = findActiveHashtag(body, cursor);
    const mention = findActiveMention(body, cursor);
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
  }, [body, cursor, suppressedHashtags, suppressedMentions]);

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

useEffect(() => {
  if (!focusCommentId) return;
  const target = commentRefs.current[focusCommentId];
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}, [comments, focusCommentId]);

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
  mirror.textContent = body.slice(0, start);
  const marker = document.createElement("span");
  marker.textContent = symbol;
  mirror.appendChild(marker);
  const after = document.createTextNode(body.slice(start + 1));
  mirror.appendChild(after);
  document.body.appendChild(mirror);
  const rect = marker.getBoundingClientRect();
    setter({ top: rect.top - 7, left: rect.left });
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
}, [suggestionsOpen, activeTag, body]);

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
}, [mentionOpen, activeMention, body]);

  const loadReplies = async (commentId: string, reset = false) => {
    setReplies((prev) => ({
      ...prev,
      [commentId]: {
        ...(reset ? { items: [], offset: 0, total: null } : prev[commentId] || { items: [], offset: 0, total: null }),
        loading: true,
      },
    }));
    const state = reset ? { items: [], offset: 0, total: replies[commentId]?.total ?? null } : replies[commentId] || { items: [], offset: 0, total: null };
    try {
      const data = await api.listReplies(commentId, 10, state.offset, token);
      const nextOffset = state.offset + data.length;
      const total = state.total ?? (data.length < 10 ? nextOffset : nextOffset + 10);
      setReplies((prev) => {
        const next = {
          ...prev,
          [commentId]: {
            items: [...state.items, ...data],
            offset: nextOffset,
            total,
            loading: false,
          },
        };
        // initialize child threads placeholders
        data.forEach((r) => {
          if (!next[r.id]) {
            next[r.id] = {
              items: r.replies || [],
              offset: r.replies?.length || 0,
              total: r.replies_count ?? r.replies?.length ?? 0,
              loading: false,
            };
          }
        });
        return next;
      });
    } catch {
      setReplies((prev) => ({
        ...prev,
        [commentId]: { ...(prev[commentId] || state), loading: false },
      }));
    }
  };

  const send = async () => {
    if (!body.trim() || !token) return;
    try {
      const tags = (() => {
        const regex = /#([\p{L}\p{N}_-]+)/gu;
        const uniq = new Set<string>();
        for (const m of body.matchAll(regex)) {
          const start = m.index ?? -1;
          if (start >= 0 && suppressedHashtags.has(start)) continue;
          const word = m[1]?.toLowerCase();
          if (word) uniq.add(word);
        }
        return Array.from(uniq);
      })();
      await api.createComment(post.id, body.trim(), replyMode ? replyTo?.id : undefined, tags, token);
      setBody("");
      setSuppressedHashtags(new Set());
      setSuppressedMentions(new Set());
      setReplyTo(null);
      setReplyMode(false);
      if (replyMode && replyTo) {
        setComments((prev) =>
          prev.map((c) => (c.id === replyTo.id ? { ...c, replies_count: (c.replies_count ?? 0) + 1 } : c))
        );
        setReplies((prev) => {
          const next: typeof prev = {};
          Object.entries(prev).forEach(([id, thread]) => {
            next[id] = {
              ...thread,
              items: thread.items.map((item) =>
                item.id === replyTo.id ? { ...item, replies_count: (item.replies_count ?? 0) + 1 } : item
              ),
            };
          });
          next[replyTo.id] = {
            items: [],
            offset: 0,
            total: (prev[replyTo.id]?.total ?? replyTo.replies_count ?? 0) + 1,
            loading: false,
          };
          return next;
        });
        loadReplies(replyTo.id, true);
      } else {
        load(false);
      }
    } catch (e: any) {
      setError(e.message || "Не удалось отправить комментарий");
    }
  };

  const toggleLike = async (c: Comment) => {
    if (!token) return;
    const prev = findCommentById(c.id);
    const nextLiked = !c.liked_by_me;
    const nextCount = c.like_count + (nextLiked ? 1 : -1);
    updateCommentLocal(c.id, { liked_by_me: nextLiked, like_count: nextCount });
    try {
      if (c.liked_by_me) await api.unlikeComment(c.id, token);
      else await api.likeComment(c.id, token);
    } catch {
      if (prev) updateCommentLocal(c.id, { liked_by_me: prev.liked_by_me, like_count: prev.like_count });
    }
  };

  const remaining = total !== null ? Math.max(total - comments.length, 0) : null;
  const moreLabel = remaining !== null ? Math.min(remaining, PAGE) : PAGE;

  const togglePostLike = () => {
    if (!token) return;
    setPostMeta((prev) => {
      const nextLiked = !prev.liked_by_me;
      const patch = {
        liked_by_me: nextLiked,
        like_count: prev.like_count + (nextLiked ? 1 : -1),
      };
      const previous = prev;

      onUpdatePost?.(prev.id, patch);

      (async () => {
        try {
          if (nextLiked) await api.likePost(prev.id, token);
          else await api.unlikePost(prev.id, token);
        } catch {
          setPostMeta(previous);
          onUpdatePost?.(prev.id, { liked_by_me: previous.liked_by_me, like_count: previous.like_count });
        }
      })();

      return { ...prev, ...patch };
    });
  };

  const focusTextarea = () => {
    textareaRef.current?.focus();
  };

  const findCommentById = (id: string): Comment | null => {
    const top = comments.find((c) => c.id === id);
    if (top) return top;
    for (const thread of Object.values(replies)) {
      const hit = thread.items.find((r) => r.id === id);
      if (hit) return hit;
    }
    return null;
  };

  const updateCommentLocal = (id: string, patch: Partial<Comment>) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    setReplies((prev) => {
      const next: typeof prev = {};
      for (const [key, thread] of Object.entries(prev)) {
        next[key] = {
          ...thread,
          items: thread.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        };
      }
      return next;
    });
  };

  const renderComment = (c: Comment, depth = 0) => {
    const thread = replies[c.id];
    const items = thread?.items || [];
    const total = (thread?.total ?? c.replies_count ?? 0) || 0;
    const remaining = Math.max(total - items.length, 0);
    const hasReplies = items.length > 0;
    const displayName = c.full_name || c.username;
    const replyTarget =
      c.reply_to_full_name || c.reply_to_username
        ? c.reply_to_full_name || c.reply_to_username
        : null;

    return (
      <div
        key={c.id}
        ref={(el) => {
          commentRefs.current[c.id] = el;
        }}
        className={`border border-white/10 rounded-xl p-3 flex gap-3 ${depth > 0 ? "bg-white/5" : ""}`}
      >
        <Link
          to={`/u/${c.username}`}
          className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold text-white hover:opacity-90"
        >
          {(c.full_name || c.username || "?")[0]?.toUpperCase() || "?"}
        </Link>
        <div className="flex-1">
          <div className="flex items-center justify-between text-sm text-white/70">
            <Link to={`/u/${c.username}`} className="font-semibold text-white hover:underline">
              {displayName}
            </Link>
            <span>{timeAgo(c.created_at)}</span>
          </div>
          {replyTarget && (
            <div className="text-xs text-white/60 mt-1">
              Ответ для @{replyTarget}
            </div>
          )}
          <div className="mt-2 text-white leading-relaxed break-words">
            {replyTarget ? (
              <>
                <span className="text-sky-400 font-semibold">@{replyTarget}</span>
                <span className="ml-1">
                  {highlightHashtags(c.body, toSet(c.mentions), toSet(c.hashtags))}
                </span>
              </>
            ) : (
              highlightHashtags(c.body, toSet(c.mentions), toSet(c.hashtags))
            )}
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-white/60">
            <div className="flex items-center gap-3">
              <button
                className={`flex items-center gap-1 ${c.liked_by_me ? "text-red-400" : "text-white/70 hover:text-white"}`}
                onClick={() => toggleLike(c)}
              >
                <Heart className={`w-4 h-4 ${c.liked_by_me ? "fill-current" : ""}`} strokeWidth={1.6} />
                <span>{c.like_count}</span>
              </button>
              <button
                className="text-white/70 hover:text-white"
                onClick={() => {
                  setReplyTo(c);
                  setReplyMode(true);
                  focusTextarea();
                }}
              >
                Ответить
              </button>
            </div>
          </div>
          {hasReplies && (
            <div className="mt-3 space-y-2 pl-3 border-l border-white/10">
              {items.map((r) => renderComment(r, depth + 1))}
              {remaining > 0 && (
                <button
                  className="text-white/60 hover:text-white text-xs"
                  onClick={() => loadReplies(c.id)}
                  disabled={thread?.loading}
                >
                  Показать ещё {Math.min(remaining, 10)} ответов
                </button>
              )}
            </div>
          )}
          {!hasReplies && remaining > 0 && (
            <div className="mt-3">
              <button
                className="text-white/60 hover:text-white text-xs"
                onClick={() => loadReplies(c.id)}
                disabled={thread?.loading}
              >
                Показать ответы ({Math.min(remaining, 10)})
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return createPortal(
    <div className="fixed inset-0 w-screen h-screen z-[120] flex items-center justify-center bg-black/70 backdrop-blur-lg">
      <div ref={containerRef} className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold">Комментарии</span>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 pt-4 pb-2 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
              {post.full_name?.[0]?.toUpperCase() || post.username[0].toUpperCase()}
            </div>
            <div>
              <p className="text-white font-semibold">{post.full_name || post.username}</p>
              <p className="text-white/60 text-sm">{timeAgo(post.created_at)}</p>
            </div>
          </div>
          <p className="mt-3 text-white leading-relaxed break-words">
            {highlightHashtags(post.content, toSet(post.mentions), toSet(post.hashtags))}
          </p>
          {post.media_url && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
              <img src={post.media_url} alt="media" className="w-full h-auto object-cover" />
            </div>
          )}
          <div className="mt-3 flex items-center gap-4 text-sm text-white/70">
            <button
              className={`flex items-center gap-2 rounded-full px-2 py-1 transition ${postMeta.liked_by_me ? "text-red-300" : "hover:text-white"}`}
              onClick={togglePostLike}
              type="button"
            >
              <Heart className={`w-6 h-6 ${postMeta.liked_by_me ? "fill-current" : ""}`} strokeWidth={1.8} />
              <span>{postMeta.like_count}</span>
            </button>
            <button
              className="flex items-center gap-2 rounded-full px-2 py-1 hover:text-white transition"
              onClick={focusTextarea}
              type="button"
            >
              <MessageCircle className="w-6 h-6" strokeWidth={1.8} />
              <span>{postMeta.comment_count ?? 0}</span>
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <Eye className="w-6 h-6" strokeWidth={1.6} />
              <span>{postMeta.view_count}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {comments.map((c) => renderComment(c, 0))}
          {comments.length === 0 && !loading && <p className="text-white/60">Комментариев нет</p>}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {remaining !== null && remaining > 0 && (
            <button
              onClick={() => load(true)}
              className="w-full rounded-full border border-white/10 text-white py-2 hover:bg-white/5"
              disabled={loading}
            >
              Показать ещё {moreLabel} комментариев{total ? ` (всего ${total})` : ""}
            </button>
          )}
        </div>

        <div className="border-t border-white/10 p-3 flex flex-col gap-3">
          {replyMode && replyTo && (
            <div className="flex items-center justify-between rounded-lg border border-sky-700/40 bg-sky-500/10 px-3 py-2 text-sm text-white">
              <span>Ответить @{replyTo.username}</span>
              <button
                type="button"
                className="text-white/70 hover:text-white"
                onClick={() => {
                  setReplyMode(false);
                  setReplyTo(null);
                }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button className="nav-icon bg-white/5 border border-white/10 text-white/80 hover:text-white" type="button" aria-label="attach" disabled>
              <Paperclip className="w-5 h-5" />
            </button>
            <div className="flex-1 relative">
              <div className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                <div className="pointer-events-none whitespace-pre-wrap break-words text-white relative z-0 min-h-[48px]">
                  {body.trim().length === 0 ? (
                    <span className="text-white/40">
                      {replyMode && replyTo ? `Ответить ${replyTo.username}` : "Написать комментарий..."}
                    </span>
                  ) : (
                    highlightInlineHashtags(body, suppressedHashtags, suppressedMentions)
                  )}
                </div>
              </div>
              <textarea
                ref={textareaRef}
                className="w-full rounded-xl border-0 bg-transparent px-3 py-2 text-transparent caret-white placeholder:text-transparent focus:border-0 focus:ring-0 focus:outline-none transition absolute inset-0 z-10 resize-none overflow-hidden"
                rows={2}
                placeholder={replyMode && replyTo ? `Ответить ${replyTo.username}` : "Написать комментарий..."}
                value={body}
                onChange={(e) => {
                  let val = e.target.value;
                  const pos = e.target.selectionStart ?? val.length;
                  if (pos >= 2 && val[pos - 1] === " " && val[pos - 2] === "#") {
                    val = val.slice(0, pos - 2) + val.slice(pos);
                    e.target.value = val;
                    e.target.selectionStart = pos - 2;
                    e.target.selectionEnd = pos - 2;
                  }
                  setBody(val);
                  setCursor(e.target.selectionStart ?? val.length);
                  autoResize();
                }}
                onSelect={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                onKeyUp={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                onClick={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && activeTag) {
                    e.preventDefault();
                    const tagText = activeTag.query.trim();
                    const finalTag = tagText.length > 0 ? tagText : "";
                    const tagToInsert = `#${finalTag}`;
                    setBody((prev) => {
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
                    const mentionText = activeMention.query.trim() || mentionSuggestions[0]?.username || "";
                    if (!mentionText) return;
                    const pos = activeMention.start + mentionText.length + 2;
                    setBody((prev) => {
                      const before = prev.slice(0, activeMention.start);
                      const after = prev.slice(activeMention.end);
                      return `${before}@${mentionText} ${after}`;
                    });
                    setCursor(pos);
                    setActiveMention(null);
                    setMentionOpen(false);
                    suppressNextDetection.current = true;
                  }
                }}
              />
              <div
                ref={mirrorRef}
                className="pointer-events-none invisible absolute whitespace-pre-wrap break-words"
                aria-hidden="true"
              />
            </div>
            <button
              onClick={send}
              disabled={!body.trim() || !token}
              className={`nav-icon ${body.trim() && token ? "bg-sky-500 text-black" : "bg-white/10 text-white/60"}`}
              aria-label="send"
            >
              <SendHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      {suggestionsOpen &&
        createPortal(
          <div
            className="z-[999] overflow-hidden rounded-xl border border-white/10 bg-[#0f1116] shadow-xl"
            style={{
              position: "fixed",
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: 300,
              transform: "translateY(-100%)",
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
                {suggestionsLoading && <li className="px-3 py-2 text-sm text-white/60">Поиск...</li>}
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
              transform: "translateY(-100%)",
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
                          <img src={u.avatar_url} alt={u.username} className="w-8 h-8 rounded-full object-cover" />
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
                {mentionLoading && <li className="px-3 py-2 text-sm text-white/60">Загрузка...</li>}
              </ul>
            ) : (
              <div className="px-3 py-2 text-sm text-white/60">
                {mentionLoading ? "Поиск..." : "Введите имя пользователя"}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>,
    document.body
  );
}

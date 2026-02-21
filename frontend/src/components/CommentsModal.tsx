import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useProfileMeStore } from "../store/profileMe";
import { X, Heart, SendHorizontal, MessageCircle, Eye } from "lucide-react";
import { highlightHashtags } from "../utils/text";
import { getPostContainerColorClass } from "../utils/postColors";
import { ErrorMessage } from "./ErrorMessage";
import { CommentSkeleton } from "./CommentSkeleton";
import { usePostCacheStore } from "../store/postCache";
import { useSubscriptionsStore } from "../store/subscriptions";
import { MentionPreview } from "./MentionPreview";
import { PostMedia } from "./PostMedia";
import { PostMusic } from "./PostMusic";
import { ExpandablePostText } from "./ExpandablePostText";
import type { MediaItem, PostMusic as PostMusicItem } from "../types/media";
import { AvatarCircle } from "./Avatar";
import { VerifiedBadge } from "./VerifiedBadge";
import { useI18n } from "../i18n";
import { formatTimeAgo } from "../utils/time";

type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  username: string;
  full_name?: string;
  is_verified?: boolean;
  avatar_url?: string;
  body: string;
  created_at: string;
  liked_by_me: boolean;
  like_count: number;
  replies_count: number;
  pending?: boolean;
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
  is_verified?: boolean;
  avatar_url?: string;
  content: string;
  container_color?: string;
  created_at: string;
  media?: MediaItem[];
  music?: PostMusicItem;
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

export function CommentsModal({ post, onClose, onUpdatePost, focusCommentId }: Props) {
  const { language, pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const token = useAuthStore((s) => s.token);
  const me = useProfileMeStore((s) => s.profile);
  const patchPost = usePostCacheStore((s) => s.patch);
  const postPatch = usePostCacheStore((s) => s.byId[post.id]);
  const setFollow = useSubscriptionsStore((s) => s.setFollow);
  const [postMeta, setPostMeta] = useState(() => ({ ...post, ...(postPatch || {}) }));
  const authorSubscribed = useSubscriptionsStore((s) => {
    const uid = postMeta.user_id;
    if (!uid) return undefined;
    return s.byUserId[uid];
  });
  const [comments, setComments] = useState<Comment[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
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
  const commentsListRef = useRef<HTMLDivElement | null>(null);
  const commentsSectionRef = useRef<HTMLDivElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const commentRefs = useRef<Record<string, HTMLElement | null>>({});
  const inFlightRef = useRef(false);
  const offsetRef = useRef(0);

  useEffect(() => {
    offsetRef.current = offset;
  }, [offset]);
  
  const [cursor, setCursor] = useState(0);
  const [activeTag, setActiveTag] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeMention, setActiveMention] = useState<{ start: number; end: number; query: string } | null>(null);
  const suppressNextDetection = useRef(false);
  const [suggestions, setSuggestions] = useState<{ id: number; name: string }[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [mentionSuggestions, setMentionSuggestions] = useState<
    {
      id: string;
      username: string;
      full_name: string;
      is_verified?: boolean;
      avatar_url?: string;
      bio?: string;
    }[]
  >([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionNextOffset, setMentionNextOffset] = useState<number | null>(null);
  const [mentionPos, setMentionPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Keep modal post meta in sync with global post cache (likes, counts, etc).
  useEffect(() => {
    if (!postPatch) return;
    setPostMeta((prev) => ({ ...prev, ...postPatch }));
  }, [postPatch]);

  // Keep local post follow state in sync with the global subscriptions store.
  useEffect(() => {
    if (!postMeta.user_id) return;
    if (postMeta.is_me) return;
    if (typeof authorSubscribed !== "boolean") return;
    if (postMeta.is_subscribed === authorSubscribed) return;
    setPostMeta((prev) => ({ ...prev, is_subscribed: authorSubscribed }));
  }, [authorSubscribed, postMeta.user_id, postMeta.is_me, postMeta.is_subscribed]);

  // Sync follow state to global store
  useEffect(() => {
    if (!postMeta?.user_id || typeof postMeta.is_subscribed !== "boolean") return;
    setFollow(postMeta.user_id, postMeta.is_subscribed);
  }, [postMeta.user_id, postMeta.is_subscribed, setFollow]);
  const mentionListRef = useRef<HTMLUListElement | null>(null);
  const [suppressedHashtags, setSuppressedHashtags] = useState<Set<number>>(new Set());
  const [suppressedMentions, setSuppressedMentions] = useState<Set<number>>(new Set());
  const MIN_TA_HEIGHT = 64;
  const postColorClass = getPostContainerColorClass(postMeta.container_color);

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

    if (inFlightRef.current) return;
    inFlightRef.current = true;

    if (append) setLoadingMore(true);
    else setLoading(true);

    try {
      const reqOffset = append ? offsetRef.current : 0;   // ✅ всегда актуально
      const data = await api.listComments(post.id, PAGE, reqOffset, token);

      setComments((prev) => {
        const merged = append ? [...prev, ...data] : data;

        // ✅ (по желанию) дедуп по id на всякий случай
        const seen = new Set<string>();
        return merged.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
      });

      setReplies((prev) => {
        const next = { ...prev };
        data.forEach((c) => {
          const total = typeof c.replies_count === "number" ? c.replies_count : c.replies?.length ?? 0;
          next[c.id] = { items: c.replies || [], offset: c.replies?.length || 0, total, loading: false };
        });
        return next;
      });

      if (append) {
        setOffset((o) => o + data.length);
      } else {
        setOffset(data.length);
      }

      setHasMore(data.length === PAGE);
      setError("");
    } catch (e: any) {
      setError(e.message || tr("Пікірлерді жүктеу мүмкін болмады", "Не удалось загрузить комментарии", "Failed to load comments"));
    } finally {
      inFlightRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    setComments([]);
    setOffset(0);
    setHasMore(true);
    setLoadingMore(false);
    setReplies({});
    setError("");
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  useEffect(() => {
    const root = commentsListRef.current;
    const sentinel = loadMoreRef.current;
    if (!root || !sentinel) return;
    if (!hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          load(true);
        }
      },
      { root, rootMargin: "200px 0px" }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, offset, post.id, loading, loadingMore]);

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

  // When opening the modal, jump directly to the comments section (not the post header/media).
  useEffect(() => {
    const root = commentsListRef.current;
    const target = commentsSectionRef.current;
    if (!root || !target) return;
    // Wait for the portal to mount and layout to settle.
    requestAnimationFrame(() => {
      const rootRect = root.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const top = root.scrollTop + (targetRect.top - rootRect.top);
      root.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    });
  }, [post.id]);

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
    const draft = body.trim();
    const now = new Date().toISOString();
    const tempId = `temp-${Date.now()}`;
    const isReply = !!(replyMode && replyTo);
    const replyParent = replyTo || null;
    try {
      const tags = (() => {
        const regex = /#([\p{L}\p{N}_-]+)/gu;
        const uniq = new Set<string>();
        for (const m of draft.matchAll(regex)) {
          const start = m.index ?? -1;
          if (start >= 0 && suppressedHashtags.has(start)) continue;
          const word = m[1]?.toLowerCase();
          if (word) uniq.add(word);
        }
        return Array.from(uniq);
      })();

      const optimistic: Comment = {
        id: tempId,
        post_id: post.id,
        user_id: me?.id || "me",
        username: me?.username || "me",
        full_name: me?.full_name || me?.username || tr("Сіз", "Вы", "You"),
        body: draft,
        created_at: now,
        liked_by_me: false,
        like_count: 0,
        replies_count: 0,
        pending: true,
        reply_to_comment_id: replyMode ? replyTo?.id : undefined,
        reply_to_full_name: replyMode ? replyTo?.full_name : undefined,
        reply_to_username: replyMode ? replyTo?.username : undefined,
        hashtags: tags,
      };

      const bumpPostComments = (delta: number) => {
        setPostMeta((prev) => {
          const nextCount = (prev.comment_count ?? 0) + delta;
          const patch = { comment_count: nextCount };
          patchPost(prev.id, patch);
          onUpdatePost?.(prev.id, patch);
          return { ...prev, ...patch };
        });
      };

      if (isReply && replyParent) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === replyParent.id ? { ...c, replies_count: (c.replies_count ?? 0) + 1 } : c
          )
        );
        setReplies((prev) => {
          const thread = prev[replyParent.id] || { items: [], offset: 0, total: 0, loading: false };
          const next: typeof prev = { ...prev };
          next[replyParent.id] = {
            ...thread,
            items: [optimistic, ...thread.items],
            total: (thread.total ?? replyParent.replies_count ?? 0) + 1,
            offset: thread.offset + 1,
          };
          return next;
        });
      } else {
        setComments((prev) => [optimistic, ...prev]);
        setOffset((o) => o + 1);
      }

      bumpPostComments(1);
      setBody("");
      setSuppressedHashtags(new Set());
      setSuppressedMentions(new Set());
      setReplyTo(null);
      setReplyMode(false);
      await api.createComment(post.id, draft, isReply ? replyParent?.id : undefined, tags, token);

      if (isReply && replyParent) {
        const fresh = await api.listReplies(replyParent.id, 1, 0, token);
        const latest = fresh[0];
        if (latest) {
          setReplies((prev) => {
            const thread = prev[replyParent.id] || { items: [], offset: 0, total: 0, loading: false };
            return {
              ...prev,
              [replyParent.id]: {
                ...thread,
                items: thread.items.map((item) => (item.id === tempId ? latest : item)),
                offset: Math.max(thread.offset, thread.items.length),
              },
            };
          });
        } else {
          load(false);
        }
      } else {
        const fresh = await api.listComments(post.id, 1, 0, token);
        const latest = fresh[0];
        if (latest) {
          setComments((prev) => prev.map((c) => (c.id === tempId ? latest : c)));
        } else {
          load(false);
        }
      }
    } catch (e: any) {
      setComments((prev) => prev.filter((c) => c.id !== tempId));
      if (!isReply) {
        setOffset((o) => Math.max(o - 1, 0));
      }
      setReplies((prev) => {
        const next: typeof prev = {};
        for (const [key, thread] of Object.entries(prev)) {
          const filtered = thread.items.filter((item) => item.id !== tempId);
          const removed = thread.items.length - filtered.length;
          next[key] = {
            ...thread,
            items: filtered,
            offset: Math.max(thread.offset - removed, 0),
          };
        }
        return next;
      });
      if (isReply && replyParent) {
        setComments((prev) =>
          prev.map((c) =>
            c.id === replyParent.id ? { ...c, replies_count: Math.max((c.replies_count ?? 1) - 1, 0) } : c
          )
        );
      }
      setPostMeta((prev) => {
        const nextCount = Math.max((prev.comment_count ?? 1) - 1, 0);
        const patch = { comment_count: nextCount };
        patchPost(prev.id, patch);
        onUpdatePost?.(prev.id, patch);
        return { ...prev, ...patch };
      });
      setError(e.message || tr("Пікірді жіберу мүмкін болмады", "Не удалось отправить комментарий", "Failed to send comment"));
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

  const togglePostLike = () => {
    if (!token) return;
    setPostMeta((prev) => {
      const nextLiked = !prev.liked_by_me;
      const patch = {
        liked_by_me: nextLiked,
        like_count: prev.like_count + (nextLiked ? 1 : -1),
      };
      const previous = prev;

      patchPost(prev.id, patch);
      onUpdatePost?.(prev.id, patch);

      (async () => {
        try {
          if (nextLiked) await api.likePost(prev.id, token);
          else await api.unlikePost(prev.id, token);
        } catch {
          setPostMeta(previous);
          patchPost(prev.id, { liked_by_me: previous.liked_by_me, like_count: previous.like_count });
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

  const renderCommentCard = (
    c: Comment,
    variant: "parent" | "reply",
    after?: ReactNode
  ) => {
    const displayName = c.full_name || c.username;
    const replyTargetRaw = c.reply_to_full_name || c.reply_to_username || "";
    const replyTarget = String(replyTargetRaw || "").trim() || null;
    const replyPrefix = replyTarget ? `@${replyTarget}` : "";
    const replyPrefixWithComma =
      replyPrefix && replyPrefix.trimEnd().endsWith(",")
        ? replyPrefix.trimEnd()
        : replyPrefix
          ? `${replyPrefix},`
          : "";
    const replyBody =
      replyTarget && /^\s*,/.test(c.body || "")
        ? String(c.body || "").replace(/^\s*,\s*/, "")
        : c.body;
    const pending = c.pending === true;

    const base =
      variant === "reply" ? "border border-white/10 bg-white/5" : "border border-white/10";

    return (
      <div
        key={c.id}
        ref={(el) => {
          commentRefs.current[c.id] = el;
        }}
        className={`rounded-xl p-3 flex gap-3 ${base} ${pending ? "opacity-70 pointer-events-none" : ""}`}
      >
        <Link
          to={`/u/${c.username}`}
          className="hover:opacity-90"
        >
          <AvatarCircle
            src={c.avatar_url}
            fallback={c.full_name || c.username || "?"}
            className="w-10 h-10 flex items-center justify-center text-sm font-semibold text-white"
          />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 text-sm text-white/70 min-w-0">
            <MentionPreview username={c.username} className="">
              <Link to={`/u/${c.username}`} className="font-semibold text-white hover:underline break-words">
                <span className="inline-flex items-center gap-[3px]">
                  <span>{displayName}</span>
                  {c.is_verified ? <VerifiedBadge /> : null}
                </span>
              </Link>
            </MentionPreview>
            <span className="shrink-0">{formatTimeAgo(c.created_at, language)}</span>
          </div>
          {replyTarget && (
            <div className="text-xs text-white/60 mt-1">
              {tr("Жауап:", "Ответ для", "Reply to")} @{replyTarget}
            </div>
          )}
          <div className="mt-2 w-full max-w-full text-white leading-relaxed whitespace-pre-wrap break-words break-all">
            {replyTarget ? (
              <>
                <span className="text-sky-400 font-semibold">{replyPrefixWithComma}</span>
                <span className="ml-1">{highlightHashtags(replyBody || "", toSet(c.mentions), toSet(c.hashtags))}</span>
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
                {tr("Жауап беру", "Ответить", "Reply")}
              </button>
            </div>
          </div>
          {after}
        </div>
      </div>
    );
  };

  const renderRepliesFlat = (rootId: string) => {
    const rootThread = replies[rootId];
    const rootItems = rootThread?.items || [];
    const rootTotal = (rootThread?.total ?? findCommentById(rootId)?.replies_count ?? 0) || 0;
    const rootRemaining = Math.max(rootTotal - rootItems.length, 0);
    const rootLoading = !!rootThread?.loading && rootItems.length === 0;

    const seen = new Set<string>();
    const build = (c: Comment): JSX.Element[] => {
      if (seen.has(c.id)) return [];
      seen.add(c.id);

      const els: JSX.Element[] = [];
      els.push(
        <div key={`${c.id}-card`} className="">
          {renderCommentCard(c, "reply")}
        </div>
      );

      const thread = replies[c.id];
      const items = thread?.items || [];
      const total = (thread?.total ?? c.replies_count ?? 0) || 0;
      const remaining = Math.max(total - items.length, 0);
      const initialLoading = !!thread?.loading && items.length === 0;

      if (initialLoading) {
        els.push(
          <div key={`${c.id}-skeleton`} className="space-y-2">
            <CommentSkeleton className="bg-white/5" />
            <CommentSkeleton className="bg-white/5" />
          </div>
        );
      } else {
        items.forEach((child) => {
          els.push(...build(child));
        });

        if (remaining > 0) {
          els.push(
            <button
              key={`${c.id}-more`}
              className="text-white/60 hover:text-white text-xs"
              onClick={() => loadReplies(c.id)}
              disabled={thread?.loading}
              type="button"
            >
              {items.length > 0
                ? `${tr("Тағы көрсету", "Показать ещё", "Show more")} ${Math.min(remaining, 10)}`
                : `${tr("Жауаптарды көрсету", "Показать ответы", "Show replies")} (${Math.min(remaining, 10)})`}
            </button>
          );
        }
      }

      return els;
    };

    if (rootLoading) {
      return (
        <div className="mt-3 pt-3 border-t border-white/10 space-y-2">
          <CommentSkeleton className="bg-white/5" />
          <CommentSkeleton className="bg-white/5" />
        </div>
      );
    }

    if (rootItems.length === 0) {
      return rootRemaining > 0 ? (
        <div className="mt-3">
          <button
            className="text-white/60 hover:text-white text-xs"
            onClick={() => loadReplies(rootId)}
            disabled={rootThread?.loading}
            type="button"
          >
            {tr("Жауаптарды көрсету", "Показать ответы", "Show replies")} ({Math.min(rootRemaining, 10)})
          </button>
        </div>
      ) : null;
    }

    const els: JSX.Element[] = [];
    rootItems.forEach((r) => {
      els.push(...build(r));
    });
    if (rootRemaining > 0) {
      els.push(
        <button
          key={`${rootId}-root-more`}
          className="text-white/60 hover:text-white text-xs"
          onClick={() => loadReplies(rootId)}
          disabled={rootThread?.loading}
          type="button"
        >
          {tr("Тағы көрсету", "Показать ещё", "Show more")} {Math.min(rootRemaining, 10)}
        </button>
      );
    }

    return <div className="mt-3 pt-3 border-t border-white/10 space-y-2">{els}</div>;
  };

  return createPortal(
    <div className="fixed inset-0 w-screen h-screen z-[120] flex items-center justify-center bg-black/70 backdrop-blur-lg">
      <div ref={containerRef} className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold">{tr("Пікірлер", "Комментарии", "Comments")}</span>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div ref={commentsListRef} className="flex-1 overflow-y-auto">
          <div className={`px-4 pt-4 pb-2 border-b border-white/10 ${postColorClass}`}>
            <div className="flex items-center gap-3">
              <Link
                to={`/u/${post.username}`}
                aria-label={`${tr("Профиль", "Профиль", "Profile")} ${post.full_name || post.username}`}
                className="hover:opacity-90"
              >
                <AvatarCircle
                  src={post.avatar_url}
                  fallback={post.full_name || post.username}
                  className="w-10 h-10 flex items-center justify-center text-sm font-semibold"
                />
              </Link>
              <div>
                <p className="text-white font-semibold">
                  <MentionPreview username={post.username} className="">
                    <Link to={`/u/${post.username}`} className="hover:underline">
                      <span className="inline-flex items-center gap-[3px]">
                        <span>{post.full_name || post.username}</span>
                        {post.is_verified ? <VerifiedBadge /> : null}
                      </span>
                    </Link>
                  </MentionPreview>
                </p>
                <p className="text-white/60 text-sm">{formatTimeAgo(post.created_at, language)}</p>
              </div>
            </div>
            <ExpandablePostText
              text={postMeta.content}
              className="text-white leading-relaxed break-words whitespace-pre-wrap"
              renderText={(text) => highlightHashtags(text, toSet(postMeta.mentions), toSet(postMeta.hashtags))}
            />
            <PostMedia media={post.media} />
            <PostMusic music={post.music} />
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

          <div ref={commentsSectionRef} className="px-4 py-3">
            {loading && comments.length === 0 && !error ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((n) => (
                  <CommentSkeleton key={n} />
                ))}
              </div>
            ) : (
              <>
                <div className="space-y-3">
                  {comments.map((c) => (
                    <div key={c.id}>{renderCommentCard(c, "parent", renderRepliesFlat(c.id))}</div>
                  ))}
                </div>
                {comments.length === 0 && !loading && (
                  <p className="text-white/60 py-3">{tr("Пікір жоқ", "Комментариев нет", "No comments")}</p>
                )}
              </>
            )}
            <ErrorMessage message={error} />
            <div ref={loadMoreRef} className="min-h-[1px] flex items-center justify-center text-white/60 text-sm">
              {loadingMore
                ? tr("Жүктелуде...", "Загружаем...", "Loading...")
                : hasMore
                  ? tr("Тағы жүктелуде...", "Подгружаем ещё...", "Loading more...")
                  : ""}
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 p-3 flex flex-col gap-3">
          {replyMode && replyTo && (
            <div className="flex items-center justify-between rounded-lg border border-sky-700/40 bg-sky-500/10 px-3 py-2 text-sm text-white">
              <span>{tr("Жауап беру", "Ответить", "Reply")} @{replyTo.username}</span>
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
            <div className="flex-1 min-w-0 relative">
              <div className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                <div className="pointer-events-none whitespace-pre-wrap break-words text-white relative z-0 min-h-[48px]">
                  {body.trim().length === 0 ? (
                    <span className="text-white/40">
                      {replyMode && replyTo
                        ? `${tr("Жауап беру", "Ответить", "Reply")} ${replyTo.username}`
                        : tr("Пікір жазыңыз...", "Написать комментарий...", "Write a comment...")}
                    </span>
                  ) : (
                    highlightInlineHashtags(body, suppressedHashtags, suppressedMentions)
                  )}
                </div>
              </div>
              <textarea
                ref={textareaRef}
                className="w-full max-w-full box-border rounded-xl border-0 bg-transparent px-3 py-2 text-transparent caret-white placeholder:text-transparent focus:border-0 focus:ring-0 focus:outline-none transition absolute inset-0 z-10 resize-none overflow-hidden whitespace-pre-wrap break-words"
                rows={2}
                placeholder={
                  replyMode && replyTo
                    ? `${tr("Жауап беру", "Ответить", "Reply")} ${replyTo.username}`
                    : tr("Пікір жазыңыз...", "Написать комментарий...", "Write a comment...")
                }
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
              aria-label={tr("Жіберу", "Отправить", "Send")}
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
              <span>{tr("Хэштегтер", "Хэштеги", "Hashtags")}</span>
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
                {suggestionsLoading && (
                  <li className="px-3 py-2 text-sm text-white/60">
                    {tr("Іздеу...", "Поиск...", "Searching...")}
                  </li>
                )}
              </ul>
            ) : (
              <div className="px-3 py-2 text-sm text-white/60">
                {suggestionsLoading
                  ? tr("Іздеу...", "Поиск...", "Searching...")
                  : `${tr(
                      "Хэштег жасау үшін Enter басыңыз",
                      "Нажмите Enter, чтобы создать хэштег",
                      "Press Enter to create hashtag"
                    )} #${activeTag?.query ?? ""}`}
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
              <span>{tr("Белгілеулер", "Упоминания", "Mentions")}</span>
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
                  <li className="px-3 py-2 text-sm text-white/60">
                    {tr("Жүктелуде...", "Загрузка...", "Loading...")}
                  </li>
                )}
              </ul>
            ) : (
              <div className="px-3 py-2 text-sm text-white/60">
                {mentionLoading
                  ? tr("Іздеу...", "Поиск...", "Searching...")
                  : tr("Қолданушы атын енгізіңіз", "Введите имя пользователя", "Enter username")}
              </div>
            )}
          </div>,
          document.body
        )}
    </div>,
    document.body
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import PostComposer from "../components/PostComposer";
import { CommentsModal } from "../components/CommentsModal";
import { highlightHashtags } from "../utils/text";
import {
  Heart,
  HeartOff,
  MessageCircle,
  MoreVertical,
  Share2,
  Flag,
  Eye,
} from "lucide-react";

type FeedItem = {
  id: string;
  user_id: string;
  content: string;
  username: string;
  full_name: string;
  created_at: string;
  media_url?: string;
  like_count: number;
  liked_by_me: boolean;
  comment_count?: number;
  view_count: number;
  mentions?: string[];
  hashtags?: string[];
  is_subscribed?: boolean;
  is_me?: boolean;
};

const isHalfVisible = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  const viewH = window.innerHeight || document.documentElement.clientHeight;
  const visibleH = Math.min(rect.bottom, viewH) - Math.max(rect.top, 0);
  return visibleH >= rect.height * 0.5;
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

export default function FeedPage() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [commentsPost, setCommentsPost] = useState<FeedItem | null>(null);
  const token = useAuthStore((s) => s.token);
  const loadViewed = () => {
    try {
      const raw = localStorage.getItem("viewed_posts");
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw);
      return new Set<string>(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set<string>();
    }
  };
  const seenPosts = useRef<Set<string>>(new Set());
  const viewedPersisted = useRef<Set<string>>(loadViewed());
  const pendingTimers = useRef<Map<string, number>>(new Map());
  const observer = useRef<IntersectionObserver | null>(null);

  const updatePost = (id: string, patch: Partial<FeedItem>) => {
    setFeed((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setCommentsPost((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  };

  const refresh = async () => {
    setLoading(true);
    try {
      const { items, nextOffset } = await api.feedPage(20, 0, token);
      setFeed(items);
      setNextOffset(nextOffset);
      setError("");
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить ленту");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const target = entry.target as HTMLElement;
          const id = target.getAttribute("data-post-id");
          if (!id) return;
          if (seenPosts.current.has(id) || viewedPersisted.current.has(id)) {
            obs.unobserve(target);
            return;
          }
          if (!entry.isIntersecting) {
            const pending = pendingTimers.current.get(id);
            if (pending) {
              clearTimeout(pending);
              pendingTimers.current.delete(id);
            }
            return;
          }
          if (pendingTimers.current.has(id)) return;
          const timer = window.setTimeout(() => {
            pendingTimers.current.delete(id);
            if (seenPosts.current.has(id) || viewedPersisted.current.has(id)) return;
            if (!isHalfVisible(target)) return;
            sendView(id);
            seenPosts.current.add(id);
            obs.unobserve(target);
          }, 1000);
          pendingTimers.current.set(id, timer);
        });
      },
      { threshold: 0.5 }
    );
    observer.current = obs;
    return () => {
      obs.disconnect();
      pendingTimers.current.forEach((t) => clearTimeout(t));
      pendingTimers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadMore = async () => {
    if (loading || !token || nextOffset === null) return;
    setLoading(true);
    try {
      const { items, nextOffset: n } = await api.feedPage(20, nextOffset, token);
      setFeed((prev) => [...prev, ...items]);
      setNextOffset(n);
      setError("");
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить ленту");
    } finally {
      setLoading(false);
    }
  };

  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || nextOffset === null) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadMore();
          }
        });
      },
      { rootMargin: "200px 0px" }
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [nextOffset, token]);

  const sendView = async (postId: string) => {
    if (!token) return;
    if (viewedPersisted.current.has(postId)) return;
    try {
      await api.viewPost(postId, token);
      setFeed((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, view_count: (p.view_count || 0) + 1 } : p))
      );
      viewedPersisted.current.add(postId);
      try {
        localStorage.setItem("viewed_posts", JSON.stringify(Array.from(viewedPersisted.current)));
      } catch {
        // ignore storage errors
      }
    } catch {
      // ignore view errors silently
    }
  };

  const toggleFollow = async (post: FeedItem) => {
    if (!token || post.is_me) return;
    const nextState = !post.is_subscribed;
    updatePost(post.id, { is_subscribed: nextState });
    try {
      if (nextState) {
        await api.followUser(post.user_id, token);
      } else {
        await api.unfollowUser(post.user_id, token);
      }
    } catch {
      updatePost(post.id, { is_subscribed: post.is_subscribed });
    }
  };

  const setPostRef = (id: string) => (el: HTMLElement | null) => {
    if (!observer.current || !el) return;
    observer.current.observe(el);
  };

  useEffect(() => {
    const handler = () => setMenuOpenId(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  const toggleLike = async (id: string, liked: boolean) => {
    if (!token) return;
    const current = feed.find((p) => p.id === id);
    const nextCount = (current?.like_count ?? 0) + (liked ? -1 : 1);
    updatePost(id, { liked_by_me: !liked, like_count: nextCount });
    try {
      if (liked) await api.unlikePost(id, token);
      else await api.likePost(id, token);
    } catch (e: any) {
      setError(e.message || "Ошибка лайка");
      if (current) {
        updatePost(id, { liked_by_me: liked, like_count: current.like_count });
      }
    }
  };

  return (
    <main
      data-feed-root
      className="max-w-[672px] w-full mx-auto py-6 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/60">Лента</p>
          <h1 className="text-2xl font-semibold text-white">Что нового?</h1>
        </div>
      </div>

      <PostComposer onCreated={refresh} />

      {loading && <p className="text-gray-400">Загрузка фида...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="space-y-3">
        {feed.map((item) => (
          <article
            key={item.id}
            ref={setPostRef(item.id)}
            data-post-id={item.id}
            className="card p-4 md:p-4 transition hover:border-white/25 relative overflow-hidden"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <Link
                  to={`/u/${item.username}`}
                  className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold hover:opacity-90"
                >
                  {item.full_name?.[0]?.toUpperCase() || item.username[0].toUpperCase()}
                </Link>
                <div>
                  <Link
                    to={`/u/${item.username}`}
                    className="text-white font-semibold leading-tight flex items-center gap-2 hover:underline"
                  >
                    {item.full_name || "Без имени"}
                  </Link>
                  <p className="text-sm text-white/60">{timeAgo(item.created_at)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {item.is_me ? (
                  <span className="px-3 py-1 rounded-full border border-white/15 bg-white/5 text-white/70 text-xs">
                    Это вы
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFollow(item);
                    }}
                    className={`px-3 py-1 rounded-full text-xs border transition ${
                      item.is_subscribed
                        ? "border-white/20 text-white/80 hover:border-white/40"
                        : "border-white text-black bg-white hover:bg-white/90"
                    }`}
                  >
                    {item.is_subscribed ? "Отписаться" : "Подписаться"}
                  </button>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === item.id ? null : item.id);
                  }}
                  className="text-white/50 hover:text-white rounded-full p-2"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                  </svg>
                </button>
              </div>

              {menuOpenId === item.id && (
                <div className="absolute right-3 top-10 bg-black/90 border border-white/10 rounded-xl shadow-2xl w-44 z-20 backdrop-blur">
                  <button className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-white/5 text-white">
                    <Share2 className="w-4 h-4" strokeWidth={1.7} />
                    Поделиться
                  </button>
                  <button className="w-full flex items-center gap-2 px-4 py-3 text-sm hover:bg-white/5 text-red-300">
                    <Flag className="w-4 h-4" strokeWidth={1.7} />
                    Пожаловаться
                  </button>
                </div>
              )}
            </div>

            <p className="mt-3 text-white leading-relaxed break-words">
              {highlightHashtags(
                item.content,
                item.mentions ? new Set(item.mentions.map((m) => m.toLowerCase())) : undefined,
                item.hashtags ? new Set(item.hashtags.map((h) => h.toLowerCase())) : undefined
              )}
            </p>

            {item.media_url && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.media_url}
                  alt="media"
                  className="w-full h-auto object-cover"
                />
              </div>
            )}

            <div className="mt-4 flex items-center justify-between text-sm text-white/60">
              <div className="flex items-center gap-6">
                <button
                  onClick={() => toggleLike(item.id, item.liked_by_me)}
                  className={`flex items-center gap-2 px-2 py-1 rounded-full transition ${
                    item.liked_by_me ? "text-red-400" : "text-white/70 hover:text-white"
                  }`}
                >
                  {item.liked_by_me ? (
                    <Heart className="w-5 h-5 fill-current" strokeWidth={1.7} />
                  ) : (
                    <Heart className="w-5 h-5" strokeWidth={1.7} />
                  )}
                  <span className="font-medium">{item.like_count}</span>
                </button>

                <button
                  className="flex items-center gap-2 text-white/60 hover:text-white"
                  onClick={() => setCommentsPost(item)}
                >
                  <MessageCircle className="w-5 h-5" strokeWidth={1.7} />
                  <span>{item.comment_count ?? 0}</span>
                </button>
              </div>

              <div className="flex items-center gap-2 text-white/60">
                <Eye className="w-5 h-5" strokeWidth={1.7} />
                <span>{item.view_count ?? 0}</span>
              </div>
            </div>
          </article>
        ))}

        {!loading && feed.length === 0 && !error && (
          <div className="card p-6 text-white/70 space-y-3">
            <p>Постов пока нет.</p>
            <p className="text-sm">
              Создайте первый пост через кнопку «Опубликовать» выше.
            </p>
          </div>
        )}
      </div>
      {nextOffset !== null && (
        <div ref={loadMoreRef} className="h-10 flex items-center justify-center text-white/60 text-sm">
          {loading ? "Загрузка..." : "Подгружаем ещё..."}
        </div>
      )}
      {commentsPost && (
        <CommentsModal
          post={commentsPost}
          onUpdatePost={updatePost}
          onClose={() => setCommentsPost(null)}
        />
      )}
    </main>
  );
}

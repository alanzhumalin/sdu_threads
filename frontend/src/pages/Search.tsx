import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Hash, Search, User as UserIcon, Heart, MessageCircle, Eye } from "lucide-react";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useFeedStore } from "../store/feed";
import { usePostCacheStore } from "../store/postCache";
import { useProfileMeStore } from "../store/profileMe";
import { useSubscriptionsStore } from "../store/subscriptions";
import { useUserStatsStore } from "../store/userStats";
import { highlightHashtags } from "../utils/text";
import { CommentsModal } from "../components/CommentsModal";
import { ErrorMessage } from "../components/ErrorMessage";
import { MentionPreview } from "../components/MentionPreview";

type UserResult = {
  id: string;
  username: string;
  full_name?: string;
  bio?: string;
  avatar_url?: string;
};

type TagResult = {
  id: string;
  name: string;
  post_count?: number;
};

type FeedItem = {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  content: string;
  media_url?: string;
  created_at: string;
  updated_at?: string;
  like_count: number;
  liked_by_me: boolean;
  view_count: number;
  comment_count?: number;
  mentions?: string[];
  hashtags?: string[];
  is_subscribed?: boolean;
  is_me?: boolean;
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

export default function SearchPage() {
  const token = useAuthStore((s) => s.token);
  const feedStore = useFeedStore();
  const postPatches = usePostCacheStore((s) => s.byId);
  const patchPost = usePostCacheStore((s) => s.patch);
  const setSubsFromPosts = useSubscriptionsStore((s) => s.setManyFromPosts);
  const setFollow = useSubscriptionsStore((s) => s.setFollow);
  const subs = useSubscriptionsStore((s) => s.byUserId);
  const patchCounts = useUserStatsStore((s) => s.patchCounts);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserResult[]>([]);
  const [hashtags, setHashtags] = useState<TagResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [popular, setPopular] = useState<TagResult[]>([]);
  const [popularLoading, setPopularLoading] = useState(false);
  const [popularError, setPopularError] = useState("");

  const activeQueryRef = useRef("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [tagPosts, setTagPosts] = useState<FeedItem[]>([]);
  const [tagNextOffset, setTagNextOffset] = useState<number | null>(null);
  const [tagLoading, setTagLoading] = useState(false);
  const [tagError, setTagError] = useState("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [commentsPost, setCommentsPost] = useState<FeedItem | null>(null);

  useEffect(() => {
    const loadPopular = async () => {
      setPopularLoading(true);
      try {
        const res = await api.popularHashtags(10);
        setPopular(res);
        setPopularError("");
      } catch (e: any) {
        setPopularError(e.message || "Не удалось загрузить популярные теги");
      } finally {
        setPopularLoading(false);
      }
    };
    loadPopular();
  }, []);

  const performSearch = async (term: string) => {
    const currentMark = term;
    activeQueryRef.current = currentMark;
    setLoading(true);
    try {
      const [u, h] = await Promise.all([
        api.searchUsers(term, 15, 0, token),
        api.searchHashtags(term, 15),
      ]);
      if (activeQueryRef.current !== currentMark) return;
      setUsers(u);
      setHashtags(h);
      setError("");
    } catch (e: any) {
      if (activeQueryRef.current !== currentMark) return;
      setError(e.message || "Не удалось выполнить поиск");
      setUsers([]);
      setHashtags([]);
    } finally {
      if (activeQueryRef.current === currentMark) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      activeQueryRef.current = "";
      setUsers([]);
      setHashtags([]);
      setError("");
      setLoading(false);
      return;
    }
    // если пользователь начал печатать — выходим из режима тега
    if (selectedTag !== null) {
      setSelectedTag(null);
      setTagPosts([]);
      setTagNextOffset(null);
      setTagError("");
    }
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      performSearch(trimmed);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, token]);

  const mergePosts = (current: FeedItem[], incoming: FeedItem[]) => {
    const seen = new Set(current.map((p) => p.id));
    const res = [...current];
    incoming.forEach((p) => {
      if (!seen.has(p.id)) {
        res.push(p);
        seen.add(p.id);
      }
    });
    return res;
  };

  const selectTag = (name: string) => {
    activeQueryRef.current = "";
    setQuery("");
    setUsers([]);
    setHashtags([]);
    setError("");
    setLoading(false);
    setSelectedTag(name);
    setTagPosts([]);
    setTagNextOffset(null);
    setTagError("");
    loadTag(name, 0, false);
  };

  const loadTag = async (name: string, offset = 0, append = false) => {
    setTagLoading(true);
    try {
      const { items, nextOffset } = await api.postsByHashtag(name, 20, offset, token);
      setSubsFromPosts(items as any[]);
      setTagPosts((prev) => (append ? mergePosts(prev, items) : items));
      setTagNextOffset(nextOffset);
      setTagError("");
    } catch (e: any) {
      setTagError(e.message || "Не удалось загрузить посты");
      if (!append) {
        setTagPosts([]);
        setTagNextOffset(null);
      }
    } finally {
      setTagLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedTag) return;
    loadTag(selectedTag, 0, false);
  }, [selectedTag, token]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!selectedTag || tagNextOffset === null) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !tagLoading && tagNextOffset !== null) {
          loadTag(selectedTag, tagNextOffset, true);
        }
      },
      { rootMargin: "200px 0px" }
    );
    observerRef.current.observe(sentinel);
    return () => observerRef.current?.disconnect();
  }, [selectedTag, tagNextOffset, tagLoading]);

  const toggleLike = async (id: string, liked: boolean) => {
    if (!token) return;
    const currentBase = tagPosts.find((p) => p.id === id);
    const currentPatch = postPatches[id];
    const current = currentPatch ? { ...currentBase, ...currentPatch } : currentBase;
    const currentLikeCount = current?.like_count ?? 0;
    const nextLiked = !liked;
    const nextCount = currentLikeCount + (nextLiked ? 1 : -1);

    setTagPosts((prev) =>
      prev.map((p) => (p.id === id ? { ...p, liked_by_me: nextLiked, like_count: nextCount } : p))
    );
    patchPost(id, { liked_by_me: nextLiked, like_count: nextCount });
    feedStore.updateItem(id, { liked_by_me: nextLiked, like_count: nextCount });
    try {
      if (liked) await api.unlikePost(id, token);
      else await api.likePost(id, token);
    } catch {
      setTagPosts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, liked_by_me: liked, like_count: currentLikeCount } : p))
      );
      patchPost(id, { liked_by_me: liked, like_count: currentLikeCount });
      feedStore.updateItem(id, { liked_by_me: liked, like_count: currentLikeCount });
    }
  };

  const toggleFollow = async (post: FeedItem, currentIsSubscribed: boolean) => {
    if (!token || post.is_me) return;
    const next = !currentIsSubscribed;
    const delta = next ? 1 : -1;
    const meId = useProfileMeStore.getState().profile?.id;
    patchCounts(post.user_id, { followers: delta });
    if (meId) patchCounts(meId, { following: delta });
    setTagPosts((prev) => prev.map((p) => (p.user_id === post.user_id ? { ...p, is_subscribed: next } : p)));
    feedStore.updateByUser(post.user_id, { is_subscribed: next });
    setFollow(post.user_id, next);
    try {
      if (next) {
        await api.followUser(post.user_id, token);
      } else {
        await api.unfollowUser(post.user_id, token);
      }
    } catch {
      patchCounts(post.user_id, { followers: -delta });
      if (meId) patchCounts(meId, { following: -delta });
      setTagPosts((prev) =>
        prev.map((p) => (p.user_id === post.user_id ? { ...p, is_subscribed: currentIsSubscribed } : p))
      );
      feedStore.updateByUser(post.user_id, { is_subscribed: currentIsSubscribed });
      setFollow(post.user_id, currentIsSubscribed);
    }
  };

  const showResults = selectedTag !== null;
  const showPopular = query.trim() === "";
  return (
    <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-4 page-fade">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/60">Поиск</p>
          <h1 className="text-2xl font-semibold text-white">Найдите людей или хэштеги</h1>
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3">
        <Search className="w-5 h-5 text-white/60" strokeWidth={1.7} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Имя, ник или #тег"
          className="w-full bg-transparent outline-none text-white placeholder:text-white/40"
        />
      </div>

      {showPopular && !showResults && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Популярные хэштеги</h2>
          </div>
          <ErrorMessage message={popularError} />
          {!popularLoading && popular.length === 0 && !popularError && (
            <div className="card p-4 text-white/60 text-sm">Пока нет популярных хэштегов.</div>
          )}
          <div className="space-y-2">
            {popularLoading &&
              [1, 2, 3, 4].map((n) => (
                <div key={n} className="card p-3 flex items-center justify-between animate-pulse">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10" />
                    <div className="space-y-2">
                      <div className="h-3 bg-white/10 rounded-full w-28" />
                      <div className="h-2 bg-white/5 rounded-full w-20" />
                    </div>
                  </div>
                </div>
              ))}

            {!popularLoading &&
              popular.map((tag) => (
                <div
                  key={tag.id}
                  className="card p-3 flex items-center justify-between hover:border-white/25 transition cursor-pointer"
                  onClick={() => selectTag(tag.name)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                      <Hash className="w-5 h-5 text-white" strokeWidth={1.7} />
                    </div>
                    <div>
                      <p className="text-white font-semibold">#{tag.name}</p>
                      <p className="text-white/50 text-sm">
                        {tag.post_count ? `${tag.post_count} постов` : "Постов пока нет"}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {!showPopular && !showResults && (
        <section className="space-y-4">
          <ErrorMessage message={error} />

          <div className="space-y-2">
            <h3 className="text-sm uppercase tracking-wide text-white/50">Пользователи</h3>
            {loading && (
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="card p-3 flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-white/10" />
                    <div className="space-y-2 w-full">
                      <div className="h-3 bg-white/10 rounded-full w-1/3" />
                      <div className="h-2 bg-white/5 rounded-full w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && users.length === 0 && (
              <div className="card p-6 text-white/60 text-sm text-center">Нет пользователей по запросу</div>
            )}
            {!loading &&
              users.map((user) => (
                <Link
                  key={user.id}
                  to={`/u/${user.username}`}
                  className="card p-3 flex items-center justify-between hover:border-white/25 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                      {user.full_name?.[0]?.toUpperCase() ||
                        user.username?.[0]?.toUpperCase() ||
                        "U"}
                    </div>
                    <div>
                      <p className="text-white font-semibold">
                        <MentionPreview username={user.username} className="">
                          <span>{user.full_name || "Без имени"}</span>
                        </MentionPreview>
                      </p>
                      <p className="text-white/50 text-sm">@{user.username}</p>
                      {user.bio && <p className="text-white/50 text-xs mt-1">{user.bio}</p>}
                    </div>
                  </div>
                  <UserIcon className="w-4 h-4 text-white/40" strokeWidth={1.6} />
                </Link>
              ))}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm uppercase tracking-wide text-white/50">Хэштеги</h3>
            {loading && (
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="card p-3 flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-white/10" />
                    <div className="h-3 bg-white/10 rounded-full w-1/4" />
                  </div>
                ))}
              </div>
            )}
            {!loading && hashtags.length === 0 && (
              <div className="card p-6 text-white/60 text-sm text-center">Нет хэштегов по запросу</div>
            )}
            {!loading &&
              hashtags.map((tag) => (
                <div
                  key={tag.id}
                  className="card p-3 flex items-center justify-between hover:border-white/25 transition cursor-pointer"
                  onClick={() => selectTag(tag.name)}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                      <Hash className="w-5 h-5 text-white" strokeWidth={1.7} />
                    </div>
                    <div>
                      <p className="text-white font-semibold">#{tag.name}</p>
                    </div>
                  </div>
                </div>
              ))}
          </div>

        </section>
      )}

      {showResults && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-white/60">Посты с тегом</p>
              <h2 className="text-xl font-semibold text-white">#{selectedTag}</h2>
            </div>
            <button
              className="text-white/60 text-sm hover:text-white"
              onClick={() => {
                setSelectedTag(null);
                setTagPosts([]);
                setTagError("");
              }}
            >
              Назад к поиску
            </button>
          </div>
          <ErrorMessage message={tagError} />
          {tagLoading && tagPosts.length === 0 && (
            <p className="text-white/60 text-sm">Загрузка постов...</p>
          )}
          {!tagLoading && tagPosts.length === 0 && !tagError && (
            <div className="card p-6 text-white/60 text-sm">Постов с этим тегом пока нет.</div>
          )}

          <div className="space-y-3">
            {tagPosts.map((p) => {
              const patch = postPatches[p.id];
              const item = patch ? { ...p, ...patch } : p;
              const isMe = item.is_me === true;
              const isSub = !isMe && (subs[item.user_id] ?? item.is_subscribed ?? false);
              const postMeta = { ...item, is_subscribed: isSub, is_me: isMe };

              return (
              <article key={item.id} className="card p-4 md:p-4 transition hover:border-white/25 relative overflow-hidden">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/u/${item.username}`}
                      className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold hover:opacity-90"
                    >
                      {item.full_name?.[0]?.toUpperCase() || item.username?.[0]?.toUpperCase() || "U"}
                    </Link>
                    <div>
                      <MentionPreview username={item.username} className="">
                        <Link
                          to={`/u/${item.username}`}
                          className="text-white font-semibold leading-tight flex items-center gap-2 hover:underline"
                        >
                          {item.full_name || "Без имени"}
                        </Link>
                      </MentionPreview>
                      <p className="text-sm text-white/60">{timeAgo(item.created_at)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isMe ? (
                      <span className="px-3 py-1 rounded-full border border-white/15 bg-white/5 text-white/70 text-xs">
                        Это вы
                      </span>
                    ) : (
                      <button
                        onClick={() => toggleFollow(postMeta, isSub)}
                        className={`px-3 py-1 rounded-full text-xs border transition ${
                          isSub
                            ? "border-white/20 text-white/80 hover:border-white/40"
                            : "border-white text-black bg-white hover:bg-white/90"
                        }`}
                      >
                        {isSub ? "Отписаться" : "Подписаться"}
                      </button>
                    )}
                  </div>
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
                    <img src={item.media_url} alt="media" className="w-full h-auto object-cover" />
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
                    onClick={() => setCommentsPost(postMeta)}
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
              );
            })}
          </div>
          <div ref={sentinelRef} className="min-h-[1px] flex items-center justify-center text-white/60 text-sm">
            {tagLoading && tagPosts.length > 0
              ? "Загружаем..."
              : tagNextOffset !== null
                ? "Прокрутите, чтобы загрузить ещё"
                : ""}
          </div>
        </section>
      )}

      {commentsPost && (
        <CommentsModal
          post={commentsPost}
          onClose={() => setCommentsPost(null)}
        />
      )}
    </main>
  );
}

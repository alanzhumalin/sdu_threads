import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { Heart, MessageCircle, Eye } from "lucide-react";
import { highlightHashtags } from "../utils/text";
import { CommentsModal } from "../components/CommentsModal";
import { useFeedStore } from "../store/feed";
import { ErrorMessage } from "../components/ErrorMessage";
import { usePostCacheStore } from "../store/postCache";
import { ProfileSkeleton } from "../components/ProfileSkeleton";
import { SocialLinksOverlay } from "../components/SocialLinks";
import { PostMedia } from "../components/PostMedia";
import { useProfileMeStore } from "../store/profileMe";
import { useSubscriptionsStore } from "../store/subscriptions";
import { useUserStatsStore } from "../store/userStats";
import { MentionPreview } from "../components/MentionPreview";
import { VerifiedBadge } from "../components/VerifiedBadge";

function timeAgo(iso: string) {
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
}

export default function ProfileUserPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const { username } = useParams();
  const feedStore = useFeedStore();
  const postPatches = usePostCacheStore((s) => s.byId);
  const patchPost = usePostCacheStore((s) => s.patch);
  const subs = useSubscriptionsStore((s) => s.byUserId);
  const setFollow = useSubscriptionsStore((s) => s.setFollow);
  const setCounts = useUserStatsStore((s) => s.setCounts);
  const patchCounts = useUserStatsStore((s) => s.patchCounts);
  const [profile, setProfile] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openingChat, setOpeningChat] = useState(false);
  const [commentsPost, setCommentsPost] = useState<any | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);
  const viewed = useRef<Set<string>>(new Set());

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [username]);

  const fetchData = async () => {
    if (!token || !username) return;
    setProfile(null);
    setPosts([]);
    setError("");
    setLoading(true);
    try {
      const p = await api.profileByUsername(username, token);
      const { items } = await api.userPosts(p.id, 20, 0, token);
      const mergedProfile = { ...p, is_subscribed: subs[p.id] ?? p.is_subscribed };
      setProfile(mergedProfile);
      setCounts(p.id, { followers: p.followers, following: p.following });
      // синхронизируем глобальный store
      setFollow(p.id, mergedProfile.is_subscribed || false);
      setPosts(items.map((it) => ({ ...it, is_subscribed: subs[it.user_id] ?? it.is_subscribed })));
      setError("");
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить профиль");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [username, token]);

  useEffect(() => {
    if (!posts.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const target = entry.target as HTMLElement;
          const id = target.getAttribute("data-post-id");
          if (!id || viewed.current.has(id)) {
            obs.unobserve(target);
            return;
          }
          if (entry.isIntersecting) {
            viewed.current.add(id);
            obs.unobserve(target);
          }
        });
      },
      { threshold: 0.5 }
    );
    observer.current = obs;
    document.querySelectorAll<HTMLElement>("[data-profile-post]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [posts]);

  const toggleLike = async (id: string, liked: boolean) => {
    if (!token) return;
    const currentBase = posts.find((p) => p.id === id);
    const currentPatch = postPatches[id];
    const current = currentPatch ? { ...currentBase, ...currentPatch } : currentBase;
    const currentLikeCount = current?.like_count ?? 0;
    const nextLiked = !liked;
    const nextCount = currentLikeCount + (nextLiked ? 1 : -1);

    setPosts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, liked_by_me: nextLiked, like_count: nextCount } : p
      )
    );
    patchPost(id, { liked_by_me: nextLiked, like_count: nextCount });
    feedStore.updateItem(id, { liked_by_me: nextLiked, like_count: nextCount });
    try {
      if (liked) await api.unlikePost(id, token);
      else await api.likePost(id, token);
    } catch {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, liked_by_me: liked, like_count: currentLikeCount } : p
        )
      );
      patchPost(id, { liked_by_me: liked, like_count: currentLikeCount });
      feedStore.updateItem(id, { liked_by_me: liked, like_count: currentLikeCount });
    }
  };

  const toggleFollow = async () => {
    if (!profile || profile.is_me || !token) return;
    const current = subs[profile.id] ?? profile.is_subscribed ?? false;
    const next = !current;
    const delta = next ? 1 : -1;
    const meId = useProfileMeStore.getState().profile?.id;
    patchCounts(profile.id, { followers: delta });
    if (meId) patchCounts(meId, { following: delta });
    setProfile((p: any) =>
      p ? { ...p, is_subscribed: next, followers: (p.followers || 0) + (next ? 1 : -1) } : p
    );
    setFollow(profile.id, next);
    feedStore.updateByUser(profile.id, { is_subscribed: next });
    setPosts((prev) => prev.map((pp) => (pp.user_id === profile.id ? { ...pp, is_subscribed: next } : pp)));
    try {
      if (next) await api.followUser(profile.id, token);
      else await api.unfollowUser(profile.id, token);
    } catch {
      patchCounts(profile.id, { followers: -delta });
      if (meId) patchCounts(meId, { following: -delta });
      const rollback = !next;
      setProfile((p: any) =>
        p
          ? { ...p, is_subscribed: rollback, followers: (p.followers || 0) + (rollback ? 1 : -1) }
          : p
      );
      setFollow(profile.id, rollback);
      feedStore.updateByUser(profile.id, { is_subscribed: rollback });
      setPosts((prev) => prev.map((pp) => (pp.user_id === profile.id ? { ...pp, is_subscribed: rollback } : pp)));
    }
  };

  const openDirectChat = async () => {
    if (!token || !profile || profile.is_me || openingChat) return;
    setOpeningChat(true);
    try {
      const chat = await api.openDirectChat({ user_id: profile.id }, token);
      navigate(`/chats/${chat.id}`);
    } catch (e: any) {
      setError(e.message || "Не удалось открыть чат");
    } finally {
      setOpeningChat(false);
    }
  };

  const stats = useUserStatsStore((s) => (profile?.id ? s.byUserId[profile.id] : undefined));
  const followersCount = typeof stats?.followers === "number" ? stats.followers : profile?.followers ?? 0;
  const followingCount = typeof stats?.following === "number" ? stats.following : profile?.following ?? 0;

  if (!token) return null;

  if (loading && !profile && !error) {
    return (
      <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
        <ProfileSkeleton />
      </div>
    );
  }

  if (!loading && !profile) {
    return (
      <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
        <ErrorMessage message={error || "Не удалось загрузить профиль"} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={fetchData}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40 transition"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
      <ErrorMessage message={error} />
      {profile && (
        <div className="rounded-2xl border border-white/10 overflow-hidden bg-black shadow-xl">
          <div className="relative h-40 md:h-52 overflow-hidden">
            <div className="absolute inset-0">
              {profile.background_url ? (
                <img src={profile.background_url} alt="cover" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900" />
              )}
            </div>
          </div>
          <div className="px-4 pb-5 pt-6 md:pt-8 flex flex-col md:flex-row md:items-start md:justify-between gap-4 relative">
            <div className="flex items-start gap-4">
              <div className="relative">
                <div className="w-24 h-24 rounded-full bg-black border border-white/20 flex items-center justify-center text-3xl font-semibold text-white overflow-hidden absolute -top-14">
                  {profile.avatar_url ? (
                    <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span>{profile.full_name?.[0]?.toUpperCase() || "?"}</span>
                  )}
                </div>
                <div className="mt-12 space-y-2">
                  <p className="text-xl font-semibold text-white inline-flex items-center gap-[3px]">
                    <span>{profile.full_name || ""}</span>
                    {profile.is_verified ? <VerifiedBadge /> : null}
                  </p>
                  <p className="text-white/60">@{profile.username}</p>
                  {/* убираем вывод username, оставляем только fullname */}
                  <p className="text-white/50 text-sm">
                    На сайте с {profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "--"}
                  </p>
                  {profile.bio ? (
                    <p className="text-white/70 text-sm">{profile.bio}</p>
                  ) : (
                    <p className="text-white/40 text-sm">Нет описания</p>
                  )}
                  <div className="flex items-center gap-5 text-white/80 pt-1 text-sm">
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-white text-base">{followersCount}</span>
                      <span className="text-white/60">Подписчики</span>
                    </div>
                    <div className="flex items-baseline gap-1">
                      <span className="font-semibold text-white text-base">{followingCount}</span>
                      <span className="text-white/60">Подписки</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="md:pt-0 pt-2 flex md:justify-end">
              {profile.is_me ? (
                <button className="rounded-full border border-white/20 px-4 py-2 text-sm text-white self-start" disabled>
                  Это вы
                </button>
              ) : (
                <div className="flex flex-wrap gap-2 justify-end">
                  <button
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition self-start ${
                      (subs[profile.id] ?? profile.is_subscribed)
                        ? "bg-white/10 text-white border border-white/30 hover:border-white"
                        : "bg-white text-black hover:bg-gray-200"
                    }`}
                    onClick={toggleFollow}
                  >
                    {(subs[profile.id] ?? profile.is_subscribed) ? "Отписаться" : "Подписаться"}
                  </button>
                  <button
                    className="rounded-full px-4 py-2 text-sm font-semibold border border-white/30 bg-white/5 text-white hover:border-white transition self-start disabled:opacity-60"
                    onClick={openDirectChat}
                    disabled={openingChat}
                  >
                    {openingChat ? "Открываем..." : "Отправить сообщение"}
                  </button>
                </div>
              )}
            </div>
            <SocialLinksOverlay
              links={profile.social_links}
              className="absolute bottom-4 right-4 flex items-center gap-2"
            />
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur p-4 shadow-xl space-y-4">
        <div className="space-y-3">
          {loading && <p className="text-white/60">Загрузка...</p>}
          {!loading && posts.length === 0 && (
            <div className="py-8 flex justify-center">
              <p className="text-white/60 text-sm">Пока нет постов</p>
            </div>
          )}
          {posts.map((p) => {
            const patch = postPatches[p.id];
            const item = patch ? { ...p, ...patch } : p;

            return (
            <article
              key={p.id}
              data-profile-post
              data-post-id={p.id}
              className="card p-4 md:p-4 transition hover:border-white/25 relative overflow-hidden"
            >
              <div className="flex items-center gap-3">
                {profile?.username ? (
                  <Link
                    to={`/u/${profile.username}`}
                    aria-label={`Профиль ${profile.full_name || profile.username}`}
                    className="relative w-10 h-10 rounded-full bg-white/10 overflow-hidden flex items-center justify-center text-sm font-semibold hover:opacity-90"
                  >
                    <span aria-hidden>
                      {profile?.full_name?.[0]?.toUpperCase() || profile?.username?.[0]?.toUpperCase() || "?"}
                    </span>
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                        draggable={false}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : null}
                  </Link>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                    {profile?.full_name?.[0]?.toUpperCase() || profile?.username?.[0]?.toUpperCase() || "?"}
                  </div>
                )}
                <div>
                  <p className="text-white font-semibold leading-tight">
                    {profile?.username ? (
                      <MentionPreview username={profile.username} className="">
                        <Link to={`/u/${profile.username}`} className="hover:underline">
                          <span className="inline-flex items-center gap-[3px]">
                            <span>{profile?.full_name}</span>
                            {profile?.is_verified ? <VerifiedBadge /> : null}
                          </span>
                        </Link>
                      </MentionPreview>
                    ) : (
                      profile?.full_name
                    )}
                  </p>
                  <p className="text-sm text-white/60">{timeAgo(p.created_at)}</p>
                </div>
              </div>

              <p className="mt-3 text-white leading-relaxed break-words">
                {highlightHashtags(
                  p.content,
                  p.mentions ? new Set(p.mentions.map((m: string) => m.toLowerCase())) : undefined,
                  p.hashtags ? new Set(p.hashtags.map((h: string) => h.toLowerCase())) : undefined
                )}
              </p>

              <PostMedia media={item.media} />

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
            );
          })}
        </div>
      </div>

      {commentsPost && (
        <CommentsModal
          post={commentsPost}
          onUpdatePost={(id, patch) =>
            setPosts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
          }
          onClose={() => setCommentsPost(null)}
        />
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useFeedStore } from "../store/feed";
import { usePostCacheStore } from "../store/postCache";
import { useProfileMeStore } from "../store/profileMe";
import PostComposer from "../components/PostComposer";
import { DrawingModal } from "../components/DrawingModal";
import { ErrorMessage } from "../components/ErrorMessage";
import { ProfileSkeleton } from "../components/ProfileSkeleton";
import { Heart, MessageCircle, Eye, X, Plus, Paintbrush } from "lucide-react";
import { highlightHashtags } from "../utils/text";
import { CommentsModal } from "../components/CommentsModal";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

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

export default function ProfilePage() {
  const token = useAuthStore((s) => s.token);
  const updateFeedByUser = useFeedStore((s) => s.updateByUser);
  const cachedProfile = useProfileMeStore((s) => s.profile);
  const cachedMyPosts = useProfileMeStore((s) => s.myPosts);
  const cachedLikedPosts = useProfileMeStore((s) => s.likedPosts);
  const setCachedProfile = useProfileMeStore((s) => s.setProfile);
  const setCachedMyPosts = useProfileMeStore((s) => s.setMyPosts);
  const setCachedLikedPosts = useProfileMeStore((s) => s.setLikedPosts);

  const postPatches = usePostCacheStore((s) => s.byId);
  const patchPost = usePostCacheStore((s) => s.patch);

  const [profile, setProfile] = useState<any>(cachedProfile);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"posts" | "liked">("posts");
  const [loadingProfile, setLoadingProfile] = useState(!cachedProfile);
  const [commentsPost, setCommentsPost] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [form, setForm] = useState({
    full_name: "",
    major: "",
  });
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [bgPreview, setBgPreview] = useState<string>("");
  const [drawingTarget, setDrawingTarget] = useState<"background" | "avatar" | null>(null);
  const [imageSaving, setImageSaving] = useState<"background" | "avatar" | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);

  const seenPosts = useRef<Set<string>>(new Set());
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
  const viewedPersisted = useRef<Set<string>>(loadViewed());
  const pendingTimers = useRef<Map<string, number>>(new Map());
  const observer = useRef<IntersectionObserver | null>(null);

  const [myPosts, setMyPosts] = useState<{ items: any[]; nextOffset: number | null; loading: boolean; loadingMore: boolean; error: string }>(() => ({
    items: cachedMyPosts.items,
    nextOffset: cachedMyPosts.nextOffset,
    loading: false,
    loadingMore: false,
    error: "",
  }));
  const [likedPosts, setLikedPosts] = useState<{ items: any[]; nextOffset: number | null; loading: boolean; loadingMore: boolean; error: string }>(() => ({
    items: cachedLikedPosts.items,
    nextOffset: cachedLikedPosts.nextOffset,
    loading: false,
    loadingMore: false,
    error: "",
  }));
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerTabRef = useRef<IntersectionObserver | null>(null);

  const fetchProfile = async () => {
    if (!token) return;
    setLoadingProfile(true);
    try {
      const p = await api.profileMe(token);
      setProfile(p);
      setCachedProfile(p);
      setError("");
      loadMyPosts(p.id, 0, false);
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить профиль");
    } finally {
      setLoadingProfile(false);
    }
  };

  useEffect(() => {
    if (!token) {
      setProfile(null);
      setError("");
      setLoadingProfile(false);
      setMyPosts({ items: [], nextOffset: null, loading: false, loadingMore: false, error: "" });
      setLikedPosts({ items: [], nextOffset: null, loading: false, loadingMore: false, error: "" });
      return;
    }

    // Если профиль уже загружен — не делаем лишний refetch при навигации.
    if (cachedProfile) {
      setProfile(cachedProfile);
      setError("");
      setLoadingProfile(false);

      // Гидратируем локальный state из кеша, чтобы список постов не "прыгал".
      setMyPosts((prev) => ({
        ...prev,
        items: cachedMyPosts.items,
        nextOffset: cachedMyPosts.nextOffset,
        loading: false,
        loadingMore: false,
        error: "",
      }));
      setLikedPosts((prev) => ({
        ...prev,
        items: cachedLikedPosts.items,
        nextOffset: cachedLikedPosts.nextOffset,
        loading: false,
        loadingMore: false,
        error: "",
      }));

      if (!cachedMyPosts.loaded) {
        loadMyPosts(cachedProfile.id, 0, false);
      }
      return;
    }

    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const postsToShow = activeTab === "posts" ? myPosts.items : likedPosts.items;

  const openEdit = () => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name || "",
      major: profile.major || "",
    });
    setAvatarPreview(profile.avatar_url || "");
    setBgPreview(profile.background_url || "");
    setDrawingTarget(null);
    setSaveError("");
    setEditOpen(true);
  };

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("file_read_failed"));
      reader.readAsDataURL(file);
    });

  const applyProfileImage = async (target: "background" | "avatar", dataUrl: string) => {
    if (!token || !profile) return;
    setSaveError("");
    const prevAvatar = avatarPreview;
    const prevBg = bgPreview;
    if (target === "avatar") setAvatarPreview(dataUrl);
    else setBgPreview(dataUrl);

    setImageSaving(target);
    try {
      const updated = await api.updateProfile(
        target === "avatar" ? { avatar_url: dataUrl } : { background_url: dataUrl },
        token
      );
      setProfile(updated);
      setCachedProfile(updated);
      updateFeedByUser(updated.id, {
        full_name: updated.full_name,
        username: updated.username,
        avatar_url: updated.avatar_url,
        background_url: updated.background_url,
      });
      if (target === "avatar") setAvatarPreview(updated.avatar_url || dataUrl);
      else setBgPreview(updated.background_url || dataUrl);
    } catch (e: any) {
      if (target === "avatar") setAvatarPreview(prevAvatar);
      else setBgPreview(prevBg);
      setSaveError(e.message || "Не удалось сохранить изображение");
    } finally {
      setImageSaving(null);
    }
  };

  const handleSave = async () => {
    if (!token || !profile) return;
    setSaving(true);
    setSaveError("");
    const payload = {
      full_name: form.full_name.trim(),
      major: form.major.trim(),
    };
    try {
      const updated = await api.updateProfile(payload, token);
      setProfile(updated);
      setCachedProfile(updated);
      updateFeedByUser(updated.id, {
        full_name: updated.full_name,
        username: updated.username,
        avatar_url: updated.avatar_url,
        background_url: updated.background_url,
      });
      setEditOpen(false);
    } catch (e: any) {
      setSaveError(e.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

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
  }, [token, postsToShow]);

  const updatePost = (id: string, patch: Partial<any>) => {
    setMyPosts((prev) => ({ ...prev, items: prev.items.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    setLikedPosts((prev) => ({ ...prev, items: prev.items.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    setCommentsPost((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  };

  const toggleLike = async (id: string, liked: boolean) => {
    if (!token) return;
    const currentBase =
      myPosts.items.find((p) => p.id === id) ||
      likedPosts.items.find((p) => p.id === id);
    const currentPatch = postPatches[id];
    const current = currentPatch ? { ...currentBase, ...currentPatch } : currentBase;
    const currentLikeCount = current?.like_count ?? 0;
    const nextCount = currentLikeCount + (liked ? -1 : 1);
    updatePost(id, { liked_by_me: !liked, like_count: nextCount });
    patchPost(id, { liked_by_me: !liked, like_count: nextCount });
    try {
      if (liked) await api.unlikePost(id, token);
      else await api.likePost(id, token);
    } catch {
      if (current) {
        updatePost(id, { liked_by_me: liked, like_count: currentLikeCount });
        patchPost(id, { liked_by_me: liked, like_count: currentLikeCount });
      }
    }
  };

  const sendView = async (postId: string) => {
    if (!token) return;
    if (viewedPersisted.current.has(postId)) return;
    try {
      await api.viewPost(postId, token);
      updatePost(postId, { view_count: 1 + (myPosts.items.find((p) => p.id === postId)?.view_count || likedPosts.items.find((p) => p.id === postId)?.view_count || 0) });
      viewedPersisted.current.add(postId);
      try {
        localStorage.setItem("viewed_posts", JSON.stringify(Array.from(viewedPersisted.current)));
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  };

  const loadMyPosts = async (userId: string, offset = 0, append = false) => {
    setMyPosts((prev) => ({ ...prev, loading: !append, loadingMore: append }));
    try {
      const { items, nextOffset } = await api.userPosts(userId, 20, offset, token);
      setMyPosts((prev) => {
        const nextItems = append ? [...prev.items, ...items] : items;
        setCachedMyPosts(nextItems, nextOffset, true);
        return {
          items: nextItems,
          nextOffset,
          loading: false,
          loadingMore: false,
          error: "",
        };
      });
    } catch (e: any) {
      setMyPosts((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: e.message || "Не удалось загрузить посты",
      }));
    }
  };

  const loadLikedPosts = async (offset = 0, append = false) => {
    setLikedPosts((prev) => ({ ...prev, loading: !append, loadingMore: append }));
    try {
      const { items, nextOffset } = await api.likedPosts(20, offset, token);
      setLikedPosts((prev) => {
        const nextItems = append ? [...prev.items, ...items] : items;
        setCachedLikedPosts(nextItems, nextOffset, true);
        return {
          items: nextItems,
          nextOffset,
          loading: false,
          loadingMore: false,
          error: "",
        };
      });
    } catch (e: any) {
      setLikedPosts((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: e.message || "Не удалось загрузить понравившиеся",
      }));
    }
  };

  useEffect(() => {
    if (!profile) return;
    if (activeTab === "liked" && !cachedLikedPosts.loaded && !likedPosts.loading) {
      loadLikedPosts(0, false);
    }
  }, [activeTab, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (observerTabRef.current) observerTabRef.current.disconnect();
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    observerTabRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;
        if (activeTab === "posts" && myPosts.nextOffset !== null && !myPosts.loadingMore && !myPosts.loading && profile) {
          loadMyPosts(profile.id, myPosts.nextOffset, true);
        }
        if (activeTab === "liked" && likedPosts.nextOffset !== null && !likedPosts.loadingMore && !likedPosts.loading) {
          loadLikedPosts(likedPosts.nextOffset, true);
        }
      },
      { rootMargin: "200px 0px" }
    );
    observerTabRef.current.observe(sentinel);
    return () => observerTabRef.current?.disconnect();
  }, [activeTab, myPosts.nextOffset, likedPosts.nextOffset, myPosts.loadingMore, likedPosts.loadingMore, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPostRef = (id: string) => (el: HTMLElement | null) => {
    if (!observer.current || !el) return;
    observer.current.observe(el);
  };

  if (loadingProfile && !profile && !error) {
    return (
      <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
        <ProfileSkeleton />
      </div>
    );
  }

  if (!loadingProfile && !profile) {
    return (
      <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
        <ErrorMessage message={error || "Не удалось загрузить профиль"} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={fetchProfile}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40 transition"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  const postsLoading = activeTab === "posts" ? myPosts.loading : likedPosts.loading;

  return (
    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
      <ErrorMessage message={error} />
      <div className="rounded-2xl border border-white/10 overflow-hidden bg-black shadow-xl">
        <div className="relative h-40 md:h-52 overflow-hidden">
          <div className="absolute inset-0">
            {profile?.background_url ? (
              <img src={profile.background_url} alt="cover" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900" />
            )}
          </div>
        </div>
        <div className="px-4 pb-5 pt-6 md:pt-8 flex flex-col md:flex-row md:items-start md:justify-between gap-4 relative">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-black flex items-center justify-center text-3xl font-semibold text-white overflow-hidden absolute -top-14">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span>{profile?.full_name?.[0]?.toUpperCase() || "?"}</span>
                )}
              </div>
              <div className="mt-12 space-y-2">
                <p className="text-xl font-semibold text-white">{profile?.full_name || ""}</p>
                <p className="text-white/60">@{profile?.username}</p>
                <p className="text-white/50 text-sm">На сайте с {profile?.created_at ? formatDate(profile.created_at) : "--"}</p>
                {profile?.major && <p className="text-white/70 text-sm">{profile.major}</p>}
                <div className="flex items-center gap-5 text-white/80 pt-1 text-sm">
                  <div className="flex items-baseline gap-1">
                    <span className="font-semibold text-white text-base">{profile?.followers ?? 0}</span>
                    <span className="text-white/60">Подписчики</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="font-semibold text-white text-base">{profile?.following ?? 0}</span>
                    <span className="text-white/60">Подписки</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="md:pt-0 pt-2 flex md:justify-end">
            <button
              className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40 transition self-start"
              onClick={openEdit}
            >
              Редактировать
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur p-4 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <button
            className={`px-4 py-2 rounded-full text-sm font-semibold ${activeTab === "posts" ? "bg-white text-black" : "text-white/70 hover:text-white"}`}
            onClick={() => setActiveTab("posts")}
          >
            Посты
          </button>
          <button
            className={`px-4 py-2 rounded-full text-sm font-semibold ${activeTab === "liked" ? "bg-white text-black" : "text-white/70 hover:text-white"}`}
            onClick={() => setActiveTab("liked")}
          >
            Понравившиеся
          </button>
        </div>

        {activeTab === "posts" && (
          <PostComposer
            onCreated={() => {
              if (profile) {
                loadMyPosts(profile.id, 0, false);
              }
            }}
          />
        )}

        <div className="space-y-3">
          {postsLoading && (
            <>
              {[1, 2, 3].map((n) => (
                <div key={n} className="card p-4 md:p-4 animate-pulse space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white/10" />
                      <div className="space-y-2">
                        <div className="h-3 w-32 bg-white/10 rounded-full" />
                        <div className="h-2 w-20 bg-white/5 rounded-full" />
                      </div>
                    </div>
                    <div className="h-8 w-24 rounded-full bg-white/5" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-white/10 rounded-full" />
                    <div className="h-3 w-5/6 bg-white/10 rounded-full" />
                    <div className="h-3 w-2/3 bg-white/10 rounded-full" />
                  </div>
                  <div className="h-40 rounded-2xl bg-white/5" />
                  <div className="flex items-center justify-between pt-1">
                    <div className="h-8 w-28 rounded-full bg-white/5" />
                    <div className="h-8 w-16 rounded-full bg-white/5" />
                  </div>
                </div>
              ))}
            </>
          )}

          {!postsLoading && postsToShow.length === 0 && (
            <div className="py-8 flex justify-center">
              <p className="text-white/60 text-sm">Пока нет постов</p>
            </div>
          )}

          {!postsLoading &&
            postsToShow.map((p) => {
              const patch = postPatches[p.id];
              const item = patch ? { ...p, ...patch } : p;

              return (
              <article
                key={p.id}
                ref={setPostRef(p.id)}
                data-post-id={p.id}
                className="card p-4 md:p-4 transition hover:border-white/25 relative overflow-hidden"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                      {p.full_name?.[0]?.toUpperCase() || p.username[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white font-semibold leading-tight flex items-center gap-2">
                        {p.full_name || "Без имени"}
                      </p>
                      <p className="text-sm text-white/60">{timeAgo(p.created_at)}</p>
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-white leading-relaxed break-words">
                  {highlightHashtags(
                    p.content,
                    p.mentions ? new Set(p.mentions.map((m: string) => m.toLowerCase())) : undefined,
                    p.hashtags ? new Set(p.hashtags.map((h: string) => h.toLowerCase())) : undefined
                  )}
                </p>

                {p.media_url && (
                  <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <img
                      src={p.media_url}
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
              );
            })}
        </div>
        <div ref={sentinelRef} className="min-h-[1px] flex items-center justify-center text-white/60 text-sm">
          {activeTab === "posts"
            ? myPosts.loadingMore
              ? "Загружаем..."
              : myPosts.nextOffset !== null
                ? "Прокрутите, чтобы загрузить ещё"
                : ""
            : likedPosts.loadingMore
              ? "Загружаем..."
              : likedPosts.nextOffset !== null
                ? "Прокрутите, чтобы загрузить ещё"
                : ""}
        </div>
      </div>
      {commentsPost && (
        <CommentsModal
          post={commentsPost}
          onUpdatePost={updatePost}
          onClose={() => setCommentsPost(null)}
        />
      )}

      {editOpen &&
        createPortal(
          <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-md">
            <div className="min-h-screen w-full flex items-center justify-center px-4 py-8">
              <div className="bg-[#0b0b0f] border border-white/10 rounded-2xl w-full max-w-lg p-7 shadow-2xl relative flex flex-col gap-5">
                <button
                  className="absolute top-3 right-3 text-white/60 hover:text-white"
                  onClick={() => {
                    setDrawingTarget(null);
                    setEditOpen(false);
                  }}
                >
                  <X className="w-5 h-5" />
                </button>
                <h3 className="text-lg font-semibold text-white">Редактировать профиль</h3>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <p className="text-sm text-white/60">Фон</p>
                    <div className="relative overflow-visible">
                      <div className="relative h-36 rounded-xl overflow-hidden bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900">
                        {bgPreview ? (
                          <img src={bgPreview} alt="background" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full" />
                        )}
                        <div className="absolute right-3 bottom-3 flex items-center gap-2">
                          <button
                            className="w-8 h-8 rounded-full bg-black/60 text-white border border-white/20 hover:border-white/40 flex items-center justify-center"
                            onClick={() => setDrawingTarget("background")}
                            aria-label="Рисовать фон"
                            disabled={imageSaving === "background"}
                          >
                            <Paintbrush className="w-4 h-4" />
                          </button>
                          <button
                            className="w-8 h-8 rounded-full bg-black/60 text-white border border-white/20 hover:border-white/40 flex items-center justify-center"
                            onClick={() => bgInputRef.current?.click()}
                            aria-label={bgPreview ? "Изменить фон" : "Добавить фон"}
                            disabled={imageSaving === "background"}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                        <input
                          ref={bgInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            e.currentTarget.value = "";
                            try {
                              const dataUrl = await fileToDataUrl(file);
                              await applyProfileImage("background", dataUrl);
                            } catch (err: any) {
                              setSaveError(err?.message || "Не удалось загрузить изображение");
                            }
                          }}
                        />
                      </div>

                      <div className="absolute left-0 bottom-0 translate-y-1/2 z-10">
                        <div className="relative w-[88px] h-[88px]">
                          <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-2xl font-semibold text-white overflow-hidden relative z-10 shadow-lg shadow-black/40">
                            {avatarPreview ? (
                              <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                            ) : (
                              <span>{form.full_name?.[0]?.toUpperCase() || "?"}</span>
                            )}
                          </div>
                          <div className="absolute -right-2 bottom-0 flex flex-col gap-2 z-20">
                            <button
                              className="w-8 h-8 rounded-full bg-white text-black border border-white/40 hover:bg-white/90 flex items-center justify-center"
                              onClick={() => setDrawingTarget("avatar")}
                              aria-label="Рисовать аватар"
                              disabled={imageSaving === "avatar"}
                            >
                              <Paintbrush className="w-4 h-4" />
                            </button>
                            <button
                              className="w-8 h-8 rounded-full bg-white text-black border border-white/40 hover:bg-white/90 flex items-center justify-center"
                              onClick={() => avatarInputRef.current?.click()}
                              aria-label={avatarPreview ? "Изменить аватар" : "Добавить аватар"}
                              disabled={imageSaving === "avatar"}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              e.currentTarget.value = "";
                              try {
                                const dataUrl = await fileToDataUrl(file);
                                await applyProfileImage("avatar", dataUrl);
                              } catch (err: any) {
                                setSaveError(err?.message || "Не удалось загрузить изображение");
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 mt-8">
                  <div className="mt-0">
                    <label className="block text-sm text-white/60 mb-1.5">Полное имя</label>
                    <input
                      value={form.full_name}
                      onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                      className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:border-white/40 outline-none"
                      placeholder="Ваше имя"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-white/60 mb-1.5">Major</label>
                    <input
                      value={form.major}
                      onChange={(e) => setForm((f) => ({ ...f, major: e.target.value }))}
                      className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:border-white/40 outline-none"
                      placeholder="Например, Computer Science"
                    />
                  </div>
                  <ErrorMessage message={saveError} />
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full bg-white text-black rounded-lg py-2.5 font-semibold hover:bg-white/90 disabled:opacity-60"
                  >
                    {saving ? "Сохранение..." : "Сохранить"}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {drawingTarget && (
        <DrawingModal
          title={drawingTarget === "background" ? "Рисование фона" : "Рисование аватара"}
          canvasWidth={drawingTarget === "background" ? 1500 : 1024}
          canvasHeight={drawingTarget === "background" ? 500 : 1024}
          canvasContainerClassName={
            drawingTarget === "avatar" ? "mx-auto w-full max-w-[420px]" : "w-full"
          }
          canvasContainerStyle={{
            aspectRatio: drawingTarget === "background" ? "3 / 1" : "1 / 1",
          }}
          canvasClassName="w-full h-full rounded-xl touch-none select-none"
          onClose={() => setDrawingTarget(null)}
          onSave={async (file) => {
            const target = drawingTarget;
            setDrawingTarget(null);
            if (!target) return;
            try {
              const dataUrl = await fileToDataUrl(file);
              await applyProfileImage(target, dataUrl);
            } catch (e: any) {
              setSaveError(e?.message || "Не удалось сохранить рисунок");
            }
          }}
        />
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import PostComposer from "../components/PostComposer";
import { Heart, MessageCircle, Eye, X, Plus } from "lucide-react";
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
  const [profile, setProfile] = useState<any>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"posts" | "liked">("posts");
  const [loading, setLoading] = useState(true);
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

  const fetchAll = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [p, f] = await Promise.all([api.profileMe(token), api.feed(token)]);
      setProfile(p);
      setFeed(f);
      setError("");
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить профиль");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const myPosts = useMemo(() => feed.filter((p) => profile && p.user_id === profile.id), [feed, profile]);
  const likedPosts = useMemo(() => feed.filter((p) => p.liked_by_me), [feed]);

  const postsToShow = activeTab === "posts" ? myPosts : likedPosts;

  const openEdit = () => {
    if (!profile) return;
    setForm({
      full_name: profile.full_name || "",
      major: profile.major || "",
    });
    setAvatarPreview(profile.avatar_url || "");
    setBgPreview(profile.background_url || "");
    setSaveError("");
    setEditOpen(true);
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
      setFeed((prev) =>
        prev.map((p) =>
          p.user_id === updated.id
            ? {
                ...p,
                full_name: updated.full_name,
                username: updated.username,
              }
            : p
        )
      );
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
    setFeed((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    setCommentsPost((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  };

  const toggleLike = async (id: string, liked: boolean) => {
    if (!token) return;
    const current = feed.find((p) => p.id === id);
    const nextCount = (current?.like_count ?? 0) + (liked ? -1 : 1);
    updatePost(id, { liked_by_me: !liked, like_count: nextCount });
    try {
      if (liked) await api.unlikePost(id, token);
      else await api.likePost(id, token);
    } catch {
      if (current) updatePost(id, { liked_by_me: liked, like_count: current.like_count });
    }
  };

  const sendView = async (postId: string) => {
    if (!token) return;
    if (viewedPersisted.current.has(postId)) return;
    try {
      await api.viewPost(postId, token);
      updatePost(postId, { view_count: (feed.find((p) => p.id === postId)?.view_count || 0) + 1 });
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

  const setPostRef = (id: string) => (el: HTMLElement | null) => {
    if (!observer.current || !el) return;
    observer.current.observe(el);
  };

  return (
    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6">
      {error && <p className="text-red-400 text-sm">{error}</p>}
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
              <div className="w-24 h-24 rounded-full bg-black border border-white/20 flex items-center justify-center text-3xl font-semibold text-white overflow-hidden absolute -top-14">
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
          <div className="border border-white/10 rounded-xl">
            <PostComposer onCreated={fetchAll} />
          </div>
        )}

        <div className="space-y-3">
          {loading && <p className="text-white/60">Загрузка...</p>}
          {!loading && postsToShow.length === 0 && (
            <div className="py-8 flex justify-center">
              <p className="text-white/60 text-sm">Пока нет постов</p>
            </div>
          )}
          {postsToShow.map((p) => (
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
                {highlightHashtags(p.content)}
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
                    onClick={() => toggleLike(p.id, p.liked_by_me)}
                    className={`flex items-center gap-2 px-2 py-1 rounded-full transition ${
                      p.liked_by_me ? "text-red-400" : "text-white/70 hover:text-white"
                    }`}
                  >
                    {p.liked_by_me ? (
                      <Heart className="w-5 h-5 fill-current" strokeWidth={1.7} />
                    ) : (
                      <Heart className="w-5 h-5" strokeWidth={1.7} />
                    )}
                    <span className="font-medium">{p.like_count}</span>
                  </button>

                  <button
                    className="flex items-center gap-2 text-white/60 hover:text-white"
                    onClick={() => setCommentsPost(p)}
                  >
                    <MessageCircle className="w-5 h-5" strokeWidth={1.7} />
                    <span>{p.comment_count ?? 0}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-white/60">
                  <Eye className="w-5 h-5" strokeWidth={1.7} />
                  <span>{p.view_count ?? 0}</span>
                </div>
              </div>
            </article>
          ))}
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
                  onClick={() => setEditOpen(false)}
                >
                  <X className="w-5 h-5" />
                </button>
                <h3 className="text-lg font-semibold text-white">Редактировать профиль</h3>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <p className="text-sm text-white/60">Фон</p>
                    <div className="relative overflow-visible">
                      <div className="relative h-36 rounded-xl overflow-hidden border border-white/10 bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900">
                        {bgPreview ? (
                          <img src={bgPreview} alt="background" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full" />
                        )}
                        <button
                          className="absolute right-3 bottom-3 w-8 h-8 rounded-full bg-black/60 text-white border border-white/20 hover:border-white/40 flex items-center justify-center"
                          onClick={() => bgInputRef.current?.click()}
                          aria-label={bgPreview ? "Изменить фон" : "Добавить фон"}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                        <input
                          ref={bgInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const url = URL.createObjectURL(file);
                            setBgPreview(url);
                          }}
                        />
                      </div>

                      <div className="absolute left-0 bottom-0 translate-y-1/2 z-10">
                        <div className="relative w-[88px] h-[88px]">
                          <div className="absolute inset-0 rounded-full border-4 border-[#0b0b0f]" />
                          <div className="w-full h-full rounded-full bg-black border border-white/25 flex items-center justify-center text-2xl font-semibold text-white overflow-hidden relative z-10 shadow-lg shadow-black/40">
                            {avatarPreview ? (
                              <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                            ) : (
                              <span>{form.full_name?.[0]?.toUpperCase() || "?"}</span>
                            )}
                          </div>
                          <button
                            className="absolute -right-2 bottom-0 w-8 h-8 rounded-full bg-white text-black border border-white/40 hover:bg-white/90 z-20 flex items-center justify-center"
                            onClick={() => avatarInputRef.current?.click()}
                            aria-label={avatarPreview ? "Изменить аватар" : "Добавить аватар"}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                          <input
                            ref={avatarInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              const url = URL.createObjectURL(file);
                              setAvatarPreview(url);
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
                  {saveError && <p className="text-sm text-red-400">{saveError}</p>}
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
    </div>
  );
}

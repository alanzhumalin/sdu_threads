import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import PostComposer from "../components/PostComposer";
import { Heart, MessageCircle, Eye } from "lucide-react";
import { highlightHashtags } from "../utils/text";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function ProfilePage() {
  const token = useAuthStore((s) => s.token);
  const [profile, setProfile] = useState<any>(null);
  const [feed, setFeed] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"posts" | "liked">("posts");
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="max-w-6xl mx-auto px-3 md:px-[13rem] py-6 space-y-6">
      {error && <p className="text-red-400 text-sm">{error}</p>}
      <div className="rounded-2xl border border-white/10 overflow-hidden bg-black shadow-xl">
        <div
          className="h-36 md:h-48 w-full bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900"
          style={profile?.background_url ? { backgroundImage: `url(${profile.background_url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        />
        <div className="px-4 pb-4 -mt-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-20 h-20 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-2xl font-semibold text-white overflow-hidden">
              {profile?.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{profile?.full_name?.[0]?.toUpperCase() || "?"}</span>
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xl font-semibold text-white">{profile?.full_name || ""}</p>
              <p className="text-white/60">@{profile?.username}</p>
              <p className="text-white/50 text-sm">На сайте с {profile?.created_at ? formatDate(profile.created_at) : "--"}</p>
              {profile?.major && <p className="text-white/70 text-sm">{profile.major}</p>}
            </div>
          </div>
          <div className="flex items-center gap-6 text-white/70">
            <div className="text-center">
              <p className="text-lg font-semibold text-white">{profile?.followers ?? 0}</p>
              <p className="text-xs uppercase tracking-wide text-white/50">Подписчики</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-white">{profile?.following ?? 0}</p>
              <p className="text-xs uppercase tracking-wide text-white/50">Подписки</p>
            </div>
            <button className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40 transition">
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
          {!loading && postsToShow.length === 0 && <p className="text-white/60 text-sm">Постов нет.</p>}
          {postsToShow.map((p) => (
            <article key={p.id} className="border border-white/10 rounded-xl p-4 bg-black/50">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                    {p.full_name?.[0]?.toUpperCase() || p.username[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-semibold leading-tight">{p.full_name || p.username}</p>
                    <p className="text-sm text-white/60">{new Date(p.created_at).toLocaleString()}</p>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-white leading-relaxed break-words">{highlightHashtags(p.content)}</p>
              {p.media_url && (
                <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-black/20">
                  <img src={p.media_url} alt="media" className="w-full h-auto object-cover" />
                </div>
              )}
              <div className="mt-3 flex items-center gap-5 text-sm text-white/60">
                <span className="flex items-center gap-1"><Heart className="w-4 h-4" strokeWidth={1.6} />{p.like_count}</span>
                <span className="flex items-center gap-1"><MessageCircle className="w-4 h-4" strokeWidth={1.6} />{p.comment_count ?? 0}</span>
                <span className="flex items-center gap-1"><Eye className="w-4 h-4" strokeWidth={1.6} />{p.view_count ?? 0}</span>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

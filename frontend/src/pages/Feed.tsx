import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import PostComposer from "../components/PostComposer";
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
  id: number;
  user_id: number;
  content: string;
  username: string;
  full_name: string;
  created_at: string;
  media_url?: string;
  like_count: number;
  liked_by_me: boolean;
  comment_count?: number;
  view_count?: number;
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
  const token = useAuthStore((s) => s.token);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const data = await api.feed(token);
      setFeed(data);
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
    const handler = () => setMenuOpenId(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  const toggleLike = async (id: number, liked: boolean) => {
    if (!token) return;
    try {
      if (liked) {
        await api.unlikePost(id, token);
      } else {
        await api.likePost(id, token);
      }
      setFeed((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                liked_by_me: !liked,
                like_count: p.like_count + (liked ? -1 : 1),
              }
            : p
        )
      );
    } catch (e: any) {
      setError(e.message || "Ошибка лайка");
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-3 md:px-[9rem] py-6 space-y-4">
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
            className="card p-4 md:p-4 transition hover:border-white/25 relative overflow-hidden"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                  {item.full_name?.[0]?.toUpperCase() || item.username[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-semibold leading-tight flex items-center gap-2">
                    {item.full_name || "Без имени"}
                  </p>
                  <p className="text-sm text-white/60">{timeAgo(item.created_at)}</p>
                </div>
              </div>
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

            <p className="mt-3 text-white leading-relaxed">{item.content}</p>

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

                <div className="flex items-center gap-2 text-white/60">
                  <MessageCircle className="w-5 h-5" strokeWidth={1.7} />
                  <span>{item.comment_count ?? 0}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-white/60">
                <Eye className="w-5 h-5" strokeWidth={1.7} />
                <span>{item.view_count ?? "—"}</span>
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
    </main>
  );
}

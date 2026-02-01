import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import PostComposer from "../components/PostComposer";

type FeedItem = {
  id: number;
  user_id: number;
  content: string;
  username: string;
  full_name: string;
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
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
    <main className="max-w-5xl mx-auto px-4 md:px-10 py-8 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/60">Лента</p>
          <h1 className="text-2xl font-semibold text-white">Что нового?</h1>
        </div>
        <div className="hidden md:flex gap-2">
          <span className="pill px-3 py-1 text-sm text-white/70">Популярное</span>
          <span className="pill px-3 py-1 text-sm text-white/40">Подписки</span>
        </div>
      </div>

      <PostComposer onCreated={refresh} />

      {loading && <p className="text-gray-400">Загрузка фида...</p>}
      {error && <p className="text-red-400 text-sm">{error}</p>}

      <div className="space-y-4">
        {feed.map((item) => (
          <article
            key={item.id}
            className="card p-4 md:p-5 transition hover:border-white/25"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                  {item.full_name?.[0]?.toUpperCase() || item.username[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-semibold leading-tight">{item.full_name || item.username}</p>
                  <p className="text-sm text-white/60 flex items-center gap-2">
                    <span>@{item.username}</span>
                    <span className="text-white/30">•</span>
                    <span>{timeAgo(item.created_at)}</span>
                  </p>
                </div>
              </div>
              <button className="text-white/50 hover:text-white">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm6 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                </svg>
              </button>
            </div>

            <p className="mt-3 text-white leading-relaxed">{item.content}</p>

              <div className="mt-4 flex items-center justify-between text-sm text-white/60">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => toggleLike(item.id, item.liked_by_me)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-full border transition ${
                    item.liked_by_me
                      ? "border-white bg-white text-black"
                      : "border-white/20 hover:border-white/40"
                  }`}
                  >
                    <span className={item.liked_by_me ? "text-black" : "text-white"}>❤️</span>
                    <span className="font-medium">{item.like_count}</span>
                  </button>
                </div>
                <Link to={`/profile`} className="text-white/60 hover:text-white">Профиль автора</Link>
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

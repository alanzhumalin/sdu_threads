import { useEffect, useState } from "react";
import { Bell, MessageCircle, UserPlus, Hash, Heart, Loader2 } from "lucide-react";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";

type NotificationItem = {
  id: string;
  type: "like" | "comment" | "follow" | "mention" | string;
  actor_id: string;
  actor_username: string;
  actor_full_name?: string;
  post_id?: string;
  comment_id?: string;
  created_at: string;
  message?: string;
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

const icons: Record<string, JSX.Element> = {
  like: <Heart className="w-5 h-5 text-pink-300" strokeWidth={1.7} />,
  comment: <MessageCircle className="w-5 h-5 text-white" strokeWidth={1.7} />,
  follow: <UserPlus className="w-5 h-5 text-white" strokeWidth={1.7} />,
  mention: <Hash className="w-5 h-5 text-white" strokeWidth={1.7} />,
};

export default function NotificationsPage() {
  const token = useAuthStore((s) => s.token);
  const [tab, setTab] = useState<"all" | "mentions">("all");
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [nextOffset, setNextOffset] = useState<number | null>(null);

  const load = async (selectedTab: "all" | "mentions", offset = 0) => {
    setLoading(true);
    try {
      const { items, nextOffset } = await api.notifications(
        selectedTab === "mentions" ? "mentions" : "all",
        20,
        offset,
        token
      );
      setError("");
      if (offset === 0) setItems(items);
      else setItems((prev) => [...prev, ...items]);
      setNextOffset(nextOffset);
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить уведомления");
      if (offset === 0) setItems([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(tab, 0);
  }, [tab, token]);

  const renderMessage = (n: NotificationItem) => {
    const name = n.actor_full_name || n.actor_username || "Кто-то";
    switch (n.type) {
      case "like":
        return `${name} понравился ваш пост`;
      case "comment":
        return `${name} прокомментировал ваш пост`;
      case "follow":
        return `${name} подписался на вас`;
      case "mention":
        return `${name} упомянул вас`;
      default:
        return `${name} сделал действие`;
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-3 md:px-[13rem] py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/60">Уведомления</p>
          <h1 className="text-2xl font-semibold text-white">Все события</h1>
        </div>
      </div>

      <div className="card p-2 flex gap-2">
        {(["all", "mentions"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
            }}
            className={`flex-1 py-2 rounded-xl font-semibold transition ${
              tab === t ? "bg-white text-black" : "text-white/70 hover:bg-white/5"
            }`}
          >
            {t === "all" ? "Все" : "Упоминания"}
          </button>
        ))}
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {loading && items.length === 0 && (
        <div className="space-y-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="card p-4 flex items-center gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-full bg-white/10" />
              <div className="space-y-2 w-full">
                <div className="h-3 bg-white/10 rounded-full w-2/3" />
                <div className="h-2 bg-white/5 rounded-full w-1/4" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="card p-6 text-white/70 text-sm">Уведомлений пока нет.</div>
      )}

      <div className="space-y-3">
        {items.map((n) => (
          <div
            key={n.id}
            className="card p-4 flex items-center justify-between hover:border-white/25 transition"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                {n.actor_full_name?.[0]?.toUpperCase() || n.actor_username?.[0]?.toUpperCase() || "U"}
              </div>
              <div className="space-y-1">
                <p className="text-white font-semibold">{renderMessage(n)}</p>
                <p className="text-white/50 text-sm">{timeAgo(n.created_at)}</p>
              </div>
            </div>
            <div className="p-2 rounded-full bg-white/5">
              {icons[n.type] || <Bell className="w-5 h-5 text-white" strokeWidth={1.7} />}
            </div>
          </div>
        ))}
      </div>

      {nextOffset !== null && (
        <div className="flex items-center justify-center">
          <button
            disabled={loading}
            onClick={() => load(tab, nextOffset ?? 0)}
            className="px-4 py-2 rounded-full border border-white/20 text-white hover:border-white/40 disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? "Загружаем..." : "Показать ещё"}
          </button>
        </div>
      )}
    </main>
  );
}

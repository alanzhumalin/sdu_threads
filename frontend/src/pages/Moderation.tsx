import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";
import { ModerationRemovePostModal } from "../components/ModerationRemovePostModal";
import type { MediaItem } from "../types/media";

type ModPost = {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  avatar_url?: string;
  content: string;
  media?: MediaItem[];
  created_at: string;
  like_count: number;
  comment_count: number;
};

export default function ModerationPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ModPost[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [removePostId, setRemovePostId] = useState<string | null>(null);

  const canLoadMore = useMemo(() => typeof nextOffset === "number", [nextOffset]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inflightRef = useRef(false);

  const loadPage = async (offset: number, q: string, append: boolean) => {
    if (!token) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    setError("");
    try {
      const res = await api.moderationPosts(q, 20, offset, token);
      const page = (Array.isArray(res.items) ? res.items : []) as ModPost[];
      setItems((prev) => (append ? [...prev, ...page] : page));
      setNextOffset(typeof res.nextOffset === "number" ? res.nextOffset : null);
    } catch (e: any) {
      if (e?.code === "FORBIDDEN") {
        navigate("/", { replace: true });
        return;
      }
      setError(e?.message || "Не удалось загрузить посты");
      setNextOffset(null);
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  };

  const refresh = async () => {
    setItems([]);
    setNextOffset(0);
    await loadPage(0, query, false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    if (!canLoadMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (!canLoadMore || loading) return;
        if (typeof nextOffset !== "number") return;
        loadPage(nextOffset, query, true);
      },
      { rootMargin: "240px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [canLoadMore, loading, nextOffset, query, token]); // include token to avoid stale closures

  const doRemove = async (postId: string, reason: string) => {
    if (!token) return;
    // optimistic: remove from list immediately
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== postId));
    try {
      await api.moderationRemovePost(postId, reason, token);
    } catch (e) {
      // rollback on error
      setItems(prev);
      throw e;
    }
  };

  return (
    <main className="max-w-[672px] w-full mx-auto py-6 space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-white">Модерация</h1>
          <div className="flex gap-2">
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => navigate("/moderation/reports")}
            >
              Жалобы
            </button>
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => navigate("/moderation/logs")}
            >
              Логи
            </button>
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
              onClick={refresh}
              disabled={!token || loading}
            >
              Обновить
            </button>
          </div>
        </div>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                refresh();
              }
            }}
            placeholder="Поиск по post id / username / тексту"
            className="flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white placeholder:text-white/50 focus:border-white/30 outline-none"
          />
          <button
            type="button"
            className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
            onClick={refresh}
            disabled={!token || loading}
          >
            Найти
          </button>
        </div>

        {error ? <ErrorMessage message={error} /> : null}
      </div>

      {loading && items.length === 0 ? (
        <div className="text-white/60 text-sm">Загрузка...</div>
      ) : items.length === 0 ? (
        <div className="text-white/60 text-sm text-center py-10">Постов не найдено</div>
      ) : (
        <div className="space-y-3">
          {items.map((p) => (
            <div key={p.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex items-center gap-3">
                  <AvatarCircle
                    src={p.avatar_url}
                    fallback={p.full_name || p.username || "U"}
                    className="w-10 h-10 flex items-center justify-center text-sm font-semibold"
                  />
                  <div className="min-w-0">
                    <div className="text-white font-semibold truncate">
                      {p.full_name}{" "}
                      <span className="text-white/60 text-sm">@{p.username}</span>
                    </div>
                    <div className="text-white/60 text-xs truncate">
                      {p.created_at ? new Date(p.created_at).toLocaleString() : p.id}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  className="danger px-3 py-2 rounded-full text-sm border border-red-500/30 text-red-300 hover:bg-red-500/10 shrink-0"
                  onClick={() => setRemovePostId(p.id)}
                >
                  Скрыть
                </button>
              </div>

              <div className="text-white/70 text-xs mt-2">
                ❤ {p.like_count || 0} · 💬 {p.comment_count || 0}
              </div>

              {Array.isArray(p.media) && p.media.length > 0 && p.media[0]?.url ? (
                <div className="mt-3">
                  <div className="relative w-full h-48 rounded-2xl overflow-hidden bg-black/20">
                    <img
                      src={p.media[0]!.url}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                      draggable={false}
                    />
                    {p.media.length > 1 ? (
                      <span className="absolute top-2 right-2 rounded-full bg-black/60 text-white text-xs px-2 py-1 border border-white/10">
                        +{p.media.length - 1}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="text-white mt-3 whitespace-pre-wrap break-words">{p.content}</div>
              <div className="mt-2 text-white/60 text-xs break-all">{p.id}</div>
            </div>
          ))}

          {loading ? <div className="text-white/60 text-sm">Загрузка...</div> : null}
          <div ref={sentinelRef} />
        </div>
      )}

      {removePostId ? (
        <ModerationRemovePostModal
          postId={removePostId}
          onClose={() => setRemovePostId(null)}
          onSuccess={(reason) => doRemove(removePostId, reason)}
        />
      ) : null}
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";

type ModerationLogItem = {
  id: string;
  actor_user_id?: string;
  actor_username?: string;
  actor_full_name?: string;
  actor_avatar_url?: string;
  scope: string;
  action: string;
  target_type?: string;
  target_id?: string;
  blocked: boolean;
  reason: string;
  score: number;
  source?: string;
  matched_terms?: string[];
  labels?: Record<string, number>;
  payload?: Record<string, any>;
  created_at: string;
};

const SCOPE_OPTIONS = [
  { value: "", label: "Все scope" },
  { value: "post_text", label: "Post text" },
  { value: "post_media", label: "Post media" },
  { value: "comment_text", label: "Comment text" },
  { value: "avatar_image", label: "Avatar" },
  { value: "background_image", label: "Background" },
  { value: "post_upload", label: "Upload post" },
  { value: "avatar_upload", label: "Upload avatar" },
  { value: "background_upload", label: "Upload background" },
];

function topLabels(labels?: Record<string, number>) {
  if (!labels || typeof labels !== "object") return [];
  return Object.entries(labels)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
}

export default function ModerationLogsPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("");
  const [items, setItems] = useState<ModerationLogItem[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canLoadMore = useMemo(() => typeof nextOffset === "number", [nextOffset]);
  const inflightRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadPage = async (offset: number, currentScope: string, currentQuery: string, append: boolean) => {
    if (!token) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    setError("");
    try {
      const res = await api.moderationLogs(currentScope, currentQuery, 20, offset, token);
      const page = (Array.isArray(res.items) ? res.items : []) as ModerationLogItem[];
      setItems((prev) => (append ? [...prev, ...page] : page));
      setNextOffset(typeof res.nextOffset === "number" ? res.nextOffset : null);
    } catch (e: any) {
      if (e?.code === "FORBIDDEN") {
        navigate("/", { replace: true });
        return;
      }
      setError(e?.message || "Не удалось загрузить логи модерации");
      setNextOffset(null);
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  };

  const refresh = async () => {
    setItems([]);
    setNextOffset(0);
    await loadPage(0, scope, query, false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !canLoadMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (!canLoadMore || loading) return;
        if (typeof nextOffset !== "number") return;
        loadPage(nextOffset, scope, query, true);
      },
      { rootMargin: "220px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [canLoadMore, loading, nextOffset, query, scope, token]);

  return (
    <main className="max-w-[672px] w-full mx-auto py-6 space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-white">Логи блокировок</h1>
          <div className="flex gap-2">
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => navigate("/moderation")}
            >
              Модерация
            </button>
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => navigate("/moderation/reports")}
            >
              Жалобы
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

        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white text-sm focus:border-white/30 outline-none"
          >
            {SCOPE_OPTIONS.map((opt) => (
              <option key={opt.value || "all"} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                refresh();
              }
            }}
            placeholder="Поиск по reason / action / target / username"
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
        <div className="text-white/60 text-sm text-center py-10">Событий пока нет</div>
      ) : (
        <div className="space-y-3">
          {items.map((it) => {
            const labels = topLabels(it.labels);
            const terms = Array.isArray(it.matched_terms) ? it.matched_terms : [];
            const actor = it.actor_full_name || it.actor_username || "Unknown";
            const score = Number.isFinite(it.score) ? it.score : 0;
            return (
              <div key={it.id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <AvatarCircle
                      src={it.actor_avatar_url}
                      fallback={actor}
                      className="w-10 h-10 flex items-center justify-center text-sm font-semibold"
                    />
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">
                        {actor}{" "}
                        {it.actor_username ? (
                          <span className="text-white/60 text-sm">@{it.actor_username}</span>
                        ) : null}
                      </div>
                      <div className="text-white/60 text-xs truncate">
                        {it.created_at ? new Date(it.created_at).toLocaleString() : it.id}
                      </div>
                    </div>
                  </div>
                  <span className="rounded-full border border-red-500/30 bg-red-500/10 text-red-200 text-xs px-2 py-1 shrink-0">
                    BLOCKED
                  </span>
                </div>

                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-white/80">
                    scope: {it.scope || "-"}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-white/80">
                    action: {it.action || "-"}
                  </span>
                  {it.target_type ? (
                    <span className="rounded-full border border-white/15 bg-white/5 px-2 py-1 text-white/80">
                      target: {it.target_type}
                      {it.target_id ? `/${it.target_id}` : ""}
                    </span>
                  ) : null}
                </div>

                <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-100">
                  {it.reason || "контент не прошел модерацию"}
                </div>

                <div className="text-xs text-white/70">
                  source: <span className="text-white">{it.source || "-"}</span> · score:{" "}
                  <span className="text-white">{score.toFixed(3)}</span>
                </div>

                {terms.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {terms.map((t) => (
                      <span
                        key={`${it.id}-term-${t}`}
                        className="rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-200 text-xs px-2 py-1"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                ) : null}

                {labels.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {labels.map(([label, value]) => (
                      <span
                        key={`${it.id}-label-${label}`}
                        className="rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-200 text-xs px-2 py-1"
                      >
                        {label}: {value.toFixed(3)}
                      </span>
                    ))}
                  </div>
                ) : null}

                <details className="rounded-xl border border-white/10 bg-black/40 px-3 py-2">
                  <summary className="cursor-pointer text-xs text-white/70">Debug payload</summary>
                  <pre className="mt-2 text-xs text-white/80 whitespace-pre-wrap break-words">
                    {JSON.stringify(it.payload || {}, null, 2)}
                  </pre>
                </details>

                <div className="text-white/40 text-[11px] break-all">{it.id}</div>
              </div>
            );
          })}
          {loading ? <div className="text-white/60 text-sm">Загрузка...</div> : null}
          <div ref={sentinelRef} />
        </div>
      )}
    </main>
  );
}

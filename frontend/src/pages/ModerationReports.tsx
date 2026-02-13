import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Flag, X } from "lucide-react";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";
import { ModerationRemovePostModal } from "../components/ModerationRemovePostModal";

type ReportStatus = "open" | "resolved" | "rejected";

type ModReport = {
  id: string;
  reporter_id: string;
  reporter_username: string;
  reporter_full_name: string;
  reporter_avatar_url?: string;
  target_type: "post" | "user";
  post_id?: string;
  post_content?: string;
  post_author_username?: string;
  post_author_full_name?: string;
  post_author_avatar_url?: string;
  post_status?: "active" | "removed" | "not_found" | "";
  post_removed_at?: string | null;
  target_user_id?: string;
  target_username?: string;
  target_full_name?: string;
  target_avatar_url?: string;
  reason: string;
  details?: string;
  status: ReportStatus;
  created_at: string;
  resolved_by?: string;
  resolved_at?: string | null;
  resolution_note?: string;
};

function StatusBadge({ status }: { status: ReportStatus }) {
  const cls =
    status === "open"
      ? "bg-sky-500/15 text-sky-200 border-sky-500/30"
      : status === "resolved"
        ? "bg-emerald-500/15 text-emerald-200 border-emerald-500/30"
        : "bg-white/5 text-white/70 border-white/10";
  const label = status === "open" ? "Открытая" : status === "resolved" ? "Решена" : "Отклонена";
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs ${cls}`}>
      {label}
    </span>
  );
}

function ResolveReportModal({
  title,
  actionLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  actionLabel: string;
  onClose: () => void;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await onConfirm(note.trim());
      onClose();
    } catch (e: any) {
      setError(e?.message || "Не удалось обновить статус жалобы");
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[140] w-screen h-screen flex items-center justify-center bg-black/70 backdrop-blur-lg px-3"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Flag className="w-4 h-4 text-white/70" strokeWidth={1.7} />
            <span className="text-white font-semibold">{title}</span>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Комментарий (необязательно)"
            className="w-full min-h-[96px] resize-none rounded-xl border border-white/10 bg-black px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30"
          />

          <ErrorMessage message={error} />

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              className="flex-1 rounded-full border border-white/10 py-2 text-sm text-white hover:bg-white/5"
              onClick={onClose}
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="flex-1 rounded-full border border-white/10 py-2 text-sm text-white hover:bg-white/5 disabled:opacity-50"
            >
              {submitting ? "Сохраняем..." : actionLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default function ModerationReportsPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  const [status, setStatus] = useState<ReportStatus>("open");
  const [query, setQuery] = useState("");

  const [items, setItems] = useState<ModReport[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [removePostId, setRemovePostId] = useState<string | null>(null);
  const [resolveState, setResolveState] = useState<{
    id: string;
    next: "resolved" | "rejected";
  } | null>(null);

  const canLoadMore = useMemo(() => typeof nextOffset === "number", [nextOffset]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inflightRef = useRef(false);

  const loadPage = async (offset: number, st: ReportStatus, q: string, append: boolean) => {
    if (!token) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    setLoading(true);
    setError("");
    try {
      const res = await api.moderationReports(st, q, 20, offset, token);
      const page = (Array.isArray(res.items) ? res.items : []) as ModReport[];
      setItems((prev) => (append ? [...prev, ...page] : page));
      setNextOffset(typeof res.nextOffset === "number" ? res.nextOffset : null);
    } catch (e: any) {
      if (e?.code === "FORBIDDEN") {
        navigate("/", { replace: true });
        return;
      }
      setError(e?.message || "Не удалось загрузить жалобы");
      setNextOffset(null);
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  };

  const refresh = async () => {
    setItems([]);
    setNextOffset(0);
    await loadPage(0, status, query, false);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, status]);

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
        loadPage(nextOffset, status, query, true);
      },
      { rootMargin: "240px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [canLoadMore, loading, nextOffset, query, status, token]);

  const doRemovePost = async (postId: string, reason: string) => {
    if (!token) return;
    try {
      await api.moderationRemovePost(postId, reason, token);
      setItems((prev) =>
        prev.map((r) =>
          r.target_type === "post" && r.post_id === postId
            ? { ...r, post_status: "removed", post_removed_at: r.post_removed_at || new Date().toISOString() }
            : r
        )
      );
    } catch (e: any) {
      // If the post doesn't exist anymore, reflect it in UI instead of keeping action buttons.
      if (e?.status === 404) {
        setItems((prev) =>
          prev.map((r) =>
            r.target_type === "post" && r.post_id === postId ? { ...r, post_status: "not_found" } : r
          )
        );
      }
      throw e;
    }
  };

  const doResolve = async (reportId: string, next: "resolved" | "rejected", note: string) => {
    if (!token) return;
    const prev = items;
    // optimistic: move out of "open" tab immediately
    if (status === "open") {
      setItems((p) => p.filter((it) => it.id !== reportId));
    } else {
      setItems((p) => p.map((it) => (it.id === reportId ? { ...it, status: next } : it)));
    }
    try {
      await api.moderationResolveReport(reportId, next, note || undefined, token);
    } catch (e) {
      setItems(prev);
      throw e;
    }
  };

  const openTarget = (r: ModReport) => {
    if (r.target_type === "post" && r.post_id && r.post_status === "active") {
      navigate(`/p/${r.post_id}`);
      return;
    }
    if (r.target_type === "user" && r.target_username) {
      navigate(`/u/${r.target_username}`);
      return;
    }
  };

  return (
    <main className="max-w-[672px] w-full mx-auto py-6 space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold text-white">Жалобы</h1>
          <div className="flex gap-2">
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => navigate("/moderation")}
            >
              Посты
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

        <div className="flex flex-wrap gap-2">
          {([
            { key: "open", label: "Открытые" },
            { key: "resolved", label: "Решённые" },
            { key: "rejected", label: "Отклонённые" },
          ] as const).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStatus(t.key)}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                status === t.key
                  ? "border-white/30 bg-white/10 text-white"
                  : "border-white/10 text-white/70 hover:bg-white/5 hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
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
            placeholder="Поиск по post id / username / reporter"
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
        <div className="text-white/60 text-sm text-center py-10">
          {status === "open" ? "Открытых жалоб нет" : "Жалоб не найдено"}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((r) => {
            const targetLabel = r.target_type === "post" ? "Пост" : "Пользователь";
            const targetName =
              r.target_type === "post"
                ? r.post_author_full_name || r.post_author_username || ""
                : r.target_full_name || r.target_username || "";
            const targetUsername =
              r.target_type === "post" ? r.post_author_username : r.target_username;
            const postStatus: "active" | "removed" | "not_found" | "" =
              r.target_type === "post" ? (r.post_status || "") : "";
            const postIsActive = r.target_type === "post" && postStatus === "active";

            return (
              <div key={r.id} className="card p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <AvatarCircle
                      src={r.reporter_avatar_url}
                      fallback={r.reporter_full_name || r.reporter_username || "U"}
                      className="w-10 h-10 flex items-center justify-center text-sm font-semibold"
                    />
                    <div className="min-w-0">
                      <div className="text-white font-semibold truncate">
                        {r.reporter_full_name}{" "}
                        <span className="text-white/60 text-sm">@{r.reporter_username}</span>
                      </div>
                      <div className="text-white/60 text-xs truncate">
                        {r.created_at ? new Date(r.created_at).toLocaleString() : r.id}
                      </div>
                    </div>
                  </div>
                  <StatusBadge status={r.status} />
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-white text-sm font-semibold">{r.reason}</div>
                  {r.details ? (
                    <div className="text-white/70 text-sm mt-1 whitespace-pre-wrap break-words">
                      {r.details}
                    </div>
                  ) : null}
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <AvatarCircle
                      src={
                        r.target_type === "post" ? r.post_author_avatar_url : r.target_avatar_url
                      }
                      fallback={targetName || targetUsername || "U"}
                      className="w-9 h-9 flex items-center justify-center text-sm font-semibold"
                    />
                    <div className="min-w-0">
                      <div className="text-white/80 text-sm truncate">
                        <span className="text-white/50">{targetLabel}:</span>{" "}
                        <span className="text-white font-semibold">{targetName}</span>{" "}
                        {targetUsername ? (
                          <span className="text-white/60 text-sm">@{targetUsername}</span>
                        ) : null}
                      </div>
                      {r.target_type === "post" && r.post_content ? (
                        <div className="text-white/60 text-xs mt-0.5 truncate">
                          {r.post_content}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {r.target_type === "post" ? (
                    postIsActive ? (
                      <button
                        type="button"
                        className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 shrink-0"
                        onClick={() => openTarget(r)}
                      >
                        Открыть
                      </button>
                    ) : (
                      <span className="text-white/60 text-sm shrink-0">
                        {postStatus === "removed"
                          ? "Пост скрыт"
                          : postStatus === "not_found"
                            ? "Пост не найден"
                            : "Пост недоступен"}
                      </span>
                    )
                  ) : (
                    <button
                      type="button"
                      className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 shrink-0"
                      onClick={() => openTarget(r)}
                      disabled={!r.target_username}
                    >
                      Открыть
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  {r.target_type === "post" && r.post_id && postIsActive ? (
                    <button
                      type="button"
                      className="danger px-3 py-2 rounded-full text-sm border border-red-500/30 text-red-300 hover:bg-red-500/10"
                      onClick={() => setRemovePostId(r.post_id || null)}
                    >
                      Скрыть пост
                    </button>
                  ) : r.target_type === "post" ? (
                    <span className="inline-flex items-center rounded-full border border-white/10 px-3 py-2 text-sm text-white/60">
                      {postStatus === "removed"
                        ? "Пост уже скрыт"
                        : postStatus === "not_found"
                          ? "Пост не найден"
                          : "Пост недоступен"}
                    </span>
                  ) : null}

                  {r.status === "open" ? (
                    <>
                      <button
                        type="button"
                        className="rounded-full border border-white/10 px-3 py-2 text-sm text-white hover:bg-white/5 inline-flex items-center gap-2"
                        onClick={() => setResolveState({ id: r.id, next: "resolved" })}
                      >
                        <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                        Решено
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-white/10 px-3 py-2 text-sm text-white/80 hover:bg-white/5"
                        onClick={() => setResolveState({ id: r.id, next: "rejected" })}
                      >
                        Отклонить
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })}

          {loading ? <div className="text-white/60 text-sm py-2">Загрузка...</div> : null}
          <div ref={sentinelRef} />
        </div>
      )}

      {removePostId ? (
        <ModerationRemovePostModal
          postId={removePostId}
          onClose={() => setRemovePostId(null)}
          onSuccess={(reason) => doRemovePost(removePostId, reason)}
        />
      ) : null}

      {resolveState ? (
        <ResolveReportModal
          title={resolveState.next === "resolved" ? "Отметить как решено" : "Отклонить жалобу"}
          actionLabel={resolveState.next === "resolved" ? "Решено" : "Отклонить"}
          onClose={() => setResolveState(null)}
          onConfirm={(note) => doResolve(resolveState.id, resolveState.next, note)}
        />
      ) : null}
    </main>
  );
}

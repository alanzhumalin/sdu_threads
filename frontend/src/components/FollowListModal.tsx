import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X } from "lucide-react";
import { api } from "../api/client";
import { ErrorMessage } from "./ErrorMessage";
import { UserRow, UserRowSkeleton, type UserRowData } from "./UserRow";
import { useSubscriptionsStore } from "../store/subscriptions";
import { useUserStatsStore } from "../store/userStats";
import { useI18n } from "../i18n";

type Mode = "followers" | "following";

type Props = {
  open: boolean;
  mode: Mode;
  userId: string;
  token?: string | null;
  onClose: () => void;
};

const LIMIT = 20;

function mergeUsers(existing: UserRowData[], incoming: UserRowData[]) {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;
  const seen = new Set(existing.map((u) => u.id));
  const out = existing.slice();
  for (const u of incoming) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(u);
  }
  return out;
}

export function FollowListModal({ open, mode, userId, token, onClose }: Props) {
  const { pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const title = mode === "followers"
    ? tr("Жазылушылар", "Подписчики", "Followers")
    : tr("Жазылымдар", "Подписки", "Following");

  const [items, setItems] = useState<UserRowData[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [unfollowIds, setUnfollowIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const setManyFromPosts = useSubscriptionsStore((s) => s.setManyFromPosts);
  const setFollow = useSubscriptionsStore((s) => s.setFollow);
  const patchCounts = useUserStatsStore((s) => s.patchCounts);

  const requestSeq = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pendingUnfollowRef = useRef<Set<string>>(new Set());

  const fetchPage = async (offset: number, append: boolean, seq: number) => {
    if (!userId) return;
    if (!token) {
      setError(tr("Сессия аяқталды. Қайта кіріңіз.", "Сессия истекла. Войдите снова.", "Session expired. Please sign in again."));
      return;
    }
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const fn = mode === "followers" ? api.followers : api.following;
      const res = await fn(userId, LIMIT, offset, token);
      if (seq !== requestSeq.current) return;
      const filtered = res.items.filter((u) => !pendingUnfollowRef.current.has(u.id));
      if (mode === "following") {
        // API /following is authoritative: those users are currently followed.
        setManyFromPosts(filtered.map((u) => ({ user_id: u.id, is_subscribed: true })));
      }
      setItems((prev) => (append ? mergeUsers(prev, filtered) : filtered));
      setNextOffset(res.nextOffset);
      setError("");
    } catch (e: any) {
      if (seq !== requestSeq.current) return;
      setError(e?.message || tr("Тізімді жүктеу мүмкін болмады", "Не удалось загрузить список", "Failed to load list"));
    } finally {
      if (seq !== requestSeq.current) return;
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };

  // Reset + initial load when modal opens or mode changes.
  useEffect(() => {
    if (!open) return;
    requestSeq.current += 1;
    const seq = requestSeq.current;
    setItems([]);
    setNextOffset(0);
    setLoading(false);
    setLoadingMore(false);
    setError("");
    fetchPage(0, false, seq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, userId]);

  const hasMore = useMemo(() => nextOffset !== null && nextOffset > 0, [nextOffset]);

  useEffect(() => {
    if (!open) return;
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    if (observerRef.current) observerRef.current.disconnect();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting) return;
        if (!hasMore) return;
        if (loading || loadingMore) return;
        if (nextOffset === null) return;
        fetchPage(nextOffset, true, requestSeq.current);
      },
      { root, threshold: 0.1 }
    );

    observerRef.current.observe(sentinel);
    return () => observerRef.current?.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, hasMore, nextOffset, loading, loadingMore, mode, userId]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const unfollow = async (user: UserRowData) => {
    if (!token) {
      setError(tr("Сессия аяқталды. Қайта кіріңіз.", "Сессия истекла. Войдите снова.", "Session expired. Please sign in again."));
      return;
    }
    if (pendingUnfollowRef.current.has(user.id)) return;

    const idx = items.findIndex((u) => u.id === user.id);
    pendingUnfollowRef.current.add(user.id);
    setUnfollowIds((prev) => new Set(prev).add(user.id));

    // Optimistic: hide user from "following" list immediately.
    setItems((prev) => prev.filter((u) => u.id !== user.id));
    setFollow(user.id, false);
    patchCounts(userId, { following: -1 });
    patchCounts(user.id, { followers: -1 });
    setNextOffset((prev) => (typeof prev === "number" && prev > 0 ? prev - 1 : prev));
    setError("");

    try {
      await api.unfollowUser(user.id, token);
    } catch (e: any) {
      // Rollback: put the row back and restore follow state.
      pendingUnfollowRef.current.delete(user.id);
      setUnfollowIds((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
      setFollow(user.id, true);
      patchCounts(userId, { following: 1 });
      patchCounts(user.id, { followers: 1 });
      setNextOffset((prev) => (typeof prev === "number" ? prev + 1 : prev));
      setItems((prev) => {
        if (prev.some((u) => u.id === user.id)) return prev;
        const next = prev.slice();
        const insertAt = idx >= 0 ? Math.min(idx, next.length) : next.length;
        next.splice(insertAt, 0, user);
        return next;
      });
      setError(e?.message || tr("Жазылымнан шығу мүмкін болмады", "Не удалось отписаться", "Failed to unfollow"));
      return;
    }

    pendingUnfollowRef.current.delete(user.id);
    setUnfollowIds((prev) => {
      const next = new Set(prev);
      next.delete(user.id);
      return next;
    });
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[260] bg-black/70 backdrop-blur-md"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="min-h-screen w-full flex items-center justify-center px-4 py-8">
        <div
          className="bg-[#0b0b0f] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl relative overflow-hidden max-h-[88vh] flex flex-col"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
            <p className="text-white font-semibold">{title}</p>
            <button
              type="button"
              className="text-white/60 hover:text-white"
              onClick={onClose}
              aria-label={tr("Жабу", "Закрыть", "Close")}
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div ref={scrollRef} className="px-5 py-4 overflow-y-auto scrollbar-hide space-y-3">
            <ErrorMessage message={error} />

            {loading && (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((n) => (
                  <UserRowSkeleton key={n} />
                ))}
              </div>
            )}

            {!loading && !error && items.length === 0 && (
              <div className="py-8 text-center text-white/60 text-sm">
                {mode === "followers"
                  ? tr("Әзірге жазылушы жоқ.", "Подписчиков пока нет.", "No followers yet.")
                  : tr("Әзірге жазылым жоқ.", "Подписок пока нет.", "Not following anyone yet.")}
              </div>
            )}

            {!loading &&
              items.map((u) => (
                <UserRow
                  key={u.id}
                  user={{
                    id: u.id,
                    username: u.username,
                    full_name: u.full_name,
                    is_verified: u.is_verified,
                    avatar_url: u.avatar_url,
                  }}
                  right={
                    mode === "following" ? (
                      <button
                        type="button"
                        className="px-3 py-1 rounded-full text-xs border border-white/20 text-white/80 hover:border-red-400/40 hover:text-red-300 transition disabled:opacity-60 disabled:cursor-not-allowed"
                        onClick={() => unfollow(u)}
                        disabled={unfollowIds.has(u.id)}
                        aria-label={tr("Жазылымнан шығу", "Отписаться", "Unfollow")}
                        title={tr("Жазылымнан шығу", "Отписаться", "Unfollow")}
                      >
                        {unfollowIds.has(u.id) ? (
                          <span className="inline-flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            {tr("Шығу...", "Отписка...", "Unfollowing...")}
                          </span>
                        ) : (
                          tr("Жазылымнан шығу", "Отписаться", "Unfollow")
                        )}
                      </button>
                    ) : null
                  }
                />
              ))}

            {loadingMore && (
              <div className="space-y-3">
                {[1, 2].map((n) => (
                  <UserRowSkeleton key={`m-${n}`} />
                ))}
              </div>
            )}

            <div ref={sentinelRef} className="h-1" />
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bell, MessageCircle, UserPlus, Hash, Heart, Loader2, ImageIcon } from "lucide-react";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { CommentsModal, PostMeta } from "../components/CommentsModal";
import { useNotificationStore } from "../store/notifications";
import { ErrorMessage } from "../components/ErrorMessage";
import { MentionPreview } from "../components/MentionPreview";
import { AvatarCircle } from "../components/Avatar";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { useI18n } from "../i18n";
import { formatTimeAgo } from "../utils/time";

type NotificationItem = {
  id: string;
  type:
    | "like"
    | "comment"
    | "follow"
    | "new_post"
    | "mention_post"
    | "mention_comment"
    | "reply_comment"
    | string;
  actor_id: string;
  actor_username: string;
  actor_full_name?: string;
  actor_is_verified?: boolean;
  actor_avatar_url?: string;
  post_id?: string;
  comment_id?: string;
  post_content?: string;
  post_media_url?: string;
  comment_body?: string;
  created_at: string;
  message?: string;
  read?: boolean;
};

type Tab = "all" | "mentions";

type TabState = {
  items: NotificationItem[];
  nextOffset: number | null;
  loading: boolean;
  loadingMore: boolean;
  error: string;
};

const icons: Record<string, JSX.Element> = {
  like: <Heart className="w-5 h-5 text-red-400" strokeWidth={1.7} />,
  comment: <MessageCircle className="w-5 h-5 text-white" strokeWidth={1.7} />,
  follow: <UserPlus className="w-5 h-5 text-white" strokeWidth={1.7} />,
  new_post: <ImageIcon className="w-5 h-5 text-sky-300" strokeWidth={1.7} />,
  mention_post: <Hash className="w-5 h-5 text-white" strokeWidth={1.7} />,
  mention_comment: <Hash className="w-5 h-5 text-white" strokeWidth={1.7} />,
  reply_comment: <Hash className="w-5 h-5 text-white" strokeWidth={1.7} />,
};

export default function NotificationsPage() {
  const { t, language, pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const token = useAuthStore((s) => s.token);
  const [tab, setTab] = useState<Tab>("all");
  const [data, setData] = useState<Record<Tab, TabState>>({
    all: { items: [], nextOffset: null, loading: false, loadingMore: false, error: "" },
    mentions: { items: [], nextOffset: null, loading: false, loadingMore: false, error: "" },
  });
  const [modalPost, setModalPost] = useState<PostMeta | null>(null);
  const [focusCommentId, setFocusCommentId] = useState<string | undefined>(undefined);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  // сбрасываем счетчик при инициализации страницы, пока не загрузили данные
  useEffect(() => {
    setUnreadCount(0);
  }, [setUnreadCount]);

  const normalize = (n: NotificationItem): NotificationItem => ({
    ...n,
    read: n.read === true,
  });

  const mergeNotifications = (existing: NotificationItem[], incoming: NotificationItem[]) => {
    const seen = new Set(existing.map((i) => i.id));
    const merged = existing.map(normalize);
    incoming.forEach((item) => {
      const norm = normalize(item);
      if (!seen.has(norm.id)) {
        merged.push(norm);
        seen.add(norm.id);
      } else {
        const idx = merged.findIndex((m) => m.id === norm.id);
        if (idx >= 0) merged[idx] = { ...merged[idx], ...norm };
      }
    });
    merged.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return merged;
  };

  const load = async (selectedTab: Tab, offset = 0, append = false) => {
    setData((prev) => ({
      ...prev,
      [selectedTab]: { ...prev[selectedTab], loading: !append, loadingMore: append, error: "" },
    }));
    try {
      const { items, nextOffset } = await api.notifications(
        selectedTab === "mentions" ? "mentions" : "all",
        20,
        offset,
        token
      );
      setData((prev) => {
        const current = prev[selectedTab];
        const merged = append ? mergeNotifications(current.items, items) : mergeNotifications(items, current.items);
        const nextState = {
          ...prev,
          [selectedTab]: {
            ...current,
            items: merged,
            nextOffset,
            loading: false,
            loadingMore: false,
            error: "",
          },
        };
        const totalUnread =
          nextState.all.items.filter((i) => i.read === false).length +
          nextState.mentions.items.filter((i) => i.read === false).length;
        setUnreadCount(totalUnread);
        return nextState;
      });
    } catch (e: any) {
      setData((prev) => ({
        ...prev,
        [selectedTab]: {
          ...prev[selectedTab],
          loading: false,
          loadingMore: false,
          error: e.message || tr("Хабарландыруларды жүктеу мүмкін болмады", "Не удалось загрузить уведомления", "Failed to load notifications"),
        },
      }));
    }
  };

  const markAll = async () => {
    try {
      await api.markAllNotificationsRead(token || undefined);
      setData((prev) => {
        const next = {
          all: { ...prev.all, items: prev.all.items.map((i) => ({ ...i, read: true })), hasNew: false },
          mentions: { ...prev.mentions, items: prev.mentions.items.map((i) => ({ ...i, read: true })), hasNew: false },
        };
        return next;
      });
      setUnreadCount(0);
    } catch (e: any) {
      const msg = e?.message || tr("Хабарландыруларды оқылған деп белгілеу мүмкін болмады", "Не удалось пометить уведомления прочитанными", "Failed to mark notifications as read");
      alert(msg);
    }
  };

  useEffect(() => {
    load(tab, 0, false);
  }, [tab, token]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) {
          const state = data[tab];
          if (!state.loadingMore && !state.loading && state.nextOffset !== null) {
            load(tab, state.nextOffset, true);
          }
        }
      },
      { rootMargin: "200px 0px" }
    );
    observerRef.current.observe(sentinel);
    return () => observerRef.current?.disconnect();
  }, [data, tab]);

  const renderMessage = (n: NotificationItem) => {
    switch (n.type) {
      case "like":
        return t("notifications.action.like");
      case "comment":
        return t("notifications.action.comment");
      case "follow":
        return t("notifications.action.follow");
      case "new_post":
        return t("notifications.action.new_post");
      case "mention_post":
        return t("notifications.action.mention_post");
      case "mention_comment":
        return t("notifications.action.mention_comment");
      case "reply_comment":
        return t("notifications.action.reply_comment");
      default:
        return t("notifications.action.default");
    }
  };

  const openNotification = async (n: NotificationItem) => {
    if (!n.post_id) return;
    setFocusCommentId(n.comment_id);
    try {
      if (!n.read) {
        api.markNotificationRead(n.id, token).catch(() => {});
        setData((prev) => {
          const nextState = {
            ...prev,
            [tab]: {
              ...prev[tab],
              items: prev[tab].items.map((it) => (it.id === n.id ? { ...it, read: true } : it)),
            },
          };
          const totalUnread =
            nextState.all.items.filter((i) => !i.read).length +
            nextState.mentions.items.filter((i) => !i.read).length;
          setUnreadCount(totalUnread);
          return nextState;
        });
      }
      const p = await api.postById(n.post_id, token);
      const meta: PostMeta = {
        id: p.id,
        user_id: p.user_id,
        username: p.username,
        full_name: p.full_name,
        avatar_url: p.avatar_url,
        content: p.content,
        created_at: p.created_at,
        media: p.media,
        music: p.music,
        like_count: p.like_count,
        liked_by_me: p.liked_by_me,
        view_count: p.view_count,
        comment_count: p.comment_count,
        mentions: p.mentions,
        hashtags: p.hashtags,
        is_subscribed: p.is_subscribed,
        is_me: p.is_me,
      };
      setModalPost(meta);
    } catch (e) {
      setData((prev) => ({
        ...prev,
        [tab]: { ...prev[tab], error: (e as any)?.message || tr("Постты ашу мүмкін болмады", "Не удалось открыть пост", "Failed to open post") },
      }));
    }
  };

  const current = data[tab];

  return (
    <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-4 page-fade">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/60">{t("notifications.page_label")}</p>
          <h1 className="text-2xl font-semibold text-white">{t("notifications.page_title")}</h1>
        </div>
      </div>

      <div className="card p-2 flex gap-2">
        {(["all", "mentions"] as const).map((tabKey) => {
          const unreadTab =
            tabKey === "all"
              ? data.all.items.filter((i) => i.read === false).length
              : data.mentions.items.filter((i) => i.read === false).length;
          return (
          <button
            key={tabKey}
            onClick={() => {
              setTab(tabKey);
            }}
            className={`flex-1 py-2 rounded-xl font-semibold transition ${
              tab === tabKey ? "bg-white text-black" : "text-white/70 hover:bg-white/5"
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              {tabKey === "all" ? t("notifications.tab_all") : t("notifications.tab_mentions")}
              {unreadTab > 0 && <span className="w-2 h-2 rounded-full bg-sky-400 inline-block" />}
            </span>
          </button>
          );
        })}
        <button
          className="px-3 py-2 rounded-xl text-sm text-white/70 hover:text-white bg-white/5"
          onClick={markAll}
          disabled={current.loading}
        >
          {t("notifications.mark_all")}
        </button>
      </div>

      <ErrorMessage message={current.error} />

      {current.loading && current.items.length === 0 && (
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

      {!current.loading && current.items.length === 0 && !current.error && (
        <div className="card p-6 text-white/70 text-sm flex items-center justify-center h-32">
          {t("notifications.empty")}
        </div>
      )}


      <div className="space-y-3">
        {current.items.map((n) => (
          <div
            key={n.id}
            onClick={() => openNotification(n)}
            className={`card p-4 flex items-center justify-between hover:border-white/25 transition cursor-pointer ${
              n.read ? "opacity-80" : "border-white/30"
            }`}
          >
            <div className="flex items-start gap-3 relative w-full">
              {!n.read && (
                <span className="absolute -left-1 top-1 w-2.5 h-2.5 rounded-full bg-sky-400 shadow-[0_0_0_4px_rgba(79,168,255,0.12)]" />
              )}
              <Link
                to={`/u/${n.actor_username}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:opacity-90"
              >
                <AvatarCircle
                  src={n.actor_avatar_url}
                  fallback={n.actor_full_name || n.actor_username || "U"}
                  className="w-10 h-10 flex items-center justify-center text-sm font-semibold"
                />
              </Link>
              <div className="space-y-1 flex-1">
                <p className="text-white font-semibold">
                  <MentionPreview username={n.actor_username} className="">
                    <Link
                      to={`/u/${n.actor_username}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline"
                    >
                      <span className="inline-flex items-center gap-[3px]">
                        <span>{n.actor_full_name || n.actor_username}</span>
                        {n.actor_is_verified ? <VerifiedBadge /> : null}
                      </span>
                    </Link>
                  </MentionPreview>{" "}
                  {renderMessage(n)}
                </p>
                <p className="text-white/50 text-sm">{formatTimeAgo(n.created_at, language)}</p>
                {n.comment_body && (
                  <p className="text-white/70 text-sm border-l border-white/10 pl-2 overflow-hidden text-ellipsis">
                    {n.comment_body}
                  </p>
                )}
                <div className="text-white/70 text-sm overflow-hidden text-ellipsis">
                  {n.post_content}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {n.post_media_url && (
                <div className="w-12 h-12 rounded-lg border border-white/10 bg-white/5 overflow-hidden flex items-center justify-center">
                  <ImageIcon className="w-5 h-5 text-white/60" />
                </div>
              )}
              <div className="p-2 rounded-full bg-white/5">
                {icons[n.type] || <Bell className="w-5 h-5 text-white" strokeWidth={1.7} />}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div ref={sentinelRef} className="min-h-[1px] flex items-center justify-center text-white/60 text-sm">
        {current.loadingMore ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> {t("notifications.loading")}
          </span>
        ) : current.nextOffset !== null ? t("notifications.load_more") : ""}
      </div>

      {modalPost && (
        <CommentsModal
          post={modalPost}
          focusCommentId={focusCommentId}
          onClose={() => {
            setModalPost(null);
            setFocusCommentId(undefined);
          }}
        />
      )}
    </main>
  );
}

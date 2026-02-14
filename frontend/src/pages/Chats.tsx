import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, MessageCircle } from "lucide-react";

import { api, type ChatPreview } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";
import { VerifiedBadge } from "../components/VerifiedBadge";

const CHAT_LIST_REFRESH_MS = 20000;

type ChatListSocketEvent =
  | { type: "ready" }
  | { type: "chat_list_updated"; chat_id: string; message_id?: string }
  | { type: "error"; message?: string };

const chatListWSURL = () => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/chats/ws`;
};

const timeAgo = (iso?: string) => {
  if (!iso) return "";
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
  return date.toLocaleDateString();
};

const sortChats = (items: ChatPreview[]) =>
  [...items].sort((a, b) => {
    const ta = new Date(a.last_message_at || 0).getTime();
    const tb = new Date(b.last_message_at || 0).getTime();
    return tb - ta;
  });

const mergeChats = (current: ChatPreview[], incoming: ChatPreview[]) => {
  const byID = new Map<string, ChatPreview>();
  current.forEach((c) => byID.set(c.id, c));
  incoming.forEach((c) => byID.set(c.id, c));
  return sortChats(Array.from(byID.values()));
};

export default function ChatsPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  const [items, setItems] = useState<ChatPreview[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const refreshInFlightRef = useRef(false);
  const loadingMoreRef = useRef(false);

  const load = async (offset = 0, append = false) => {
    if (!token) return;
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await api.chats(20, offset, token);
      setItems((prev) => (append ? mergeChats(prev, res.items) : sortChats(res.items)));
      setNextOffset(res.nextOffset);
      setError("");
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить чаты");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    load(0, false);
  }, [token]);

  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const refreshTopChats = useCallback(
    async (reason: "ws" | "poll" | "focus" | "visibility" = "poll") => {
      if (!token) return;
      if (refreshInFlightRef.current || loadingMoreRef.current) return;
      refreshInFlightRef.current = true;
      try {
        const res = await api.chats(20, 0, token);
        setItems((prev) => mergeChats(prev, res.items));
      } catch {
        // do not disrupt current screen state on background refresh failures
      } finally {
        refreshInFlightRef.current = false;
      }
      void reason;
    },
    [token]
  );

  useEffect(() => {
    if (!token) return;

    const runPoll = () => {
      if (document.visibilityState !== "visible") return;
      void refreshTopChats("poll");
    };

    const intervalID = window.setInterval(runPoll, CHAT_LIST_REFRESH_MS);
    const onFocus = () => {
      void refreshTopChats("focus");
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshTopChats("visibility");
      }
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalID);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [token, refreshTopChats]);

  useEffect(() => {
    if (!token) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;

    const reconnect = () => {
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** attempts, 10000);
      attempts += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(chatListWSURL());

      socket.onopen = () => {
        socket?.send(
          JSON.stringify({
            type: "auth",
            token,
          })
        );
        attempts = 0;
      };

      socket.onmessage = (evt) => {
        let parsed: ChatListSocketEvent | null = null;
        try {
          parsed = JSON.parse(String(evt.data)) as ChatListSocketEvent;
        } catch {
          return;
        }
        if (!parsed) return;
        if (parsed.type === "chat_list_updated") {
          void refreshTopChats("ws");
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (stopped) return;
        reconnect();
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, [token, refreshTopChats]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    const sentinel = sentinelRef.current;
    if (!sentinel || loading || loadingMore || nextOffset === null) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && nextOffset !== null && !loadingMore) {
          load(nextOffset, true);
        }
      },
      { rootMargin: "200px 0px" }
    );
    observerRef.current.observe(sentinel);
    return () => observerRef.current?.disconnect();
  }, [nextOffset, loading, loadingMore, token]);

  return (
    <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-4 page-fade">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/60">Личные сообщения</p>
          <h1 className="text-2xl font-semibold text-white">Чаты</h1>
        </div>
      </div>

      <ErrorMessage message={error} />

      {loading && items.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card p-4 animate-pulse flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 rounded bg-white/10" />
                <div className="h-3 w-56 rounded bg-white/5" />
              </div>
              <div className="h-3 w-12 rounded bg-white/5" />
            </div>
          ))}
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white/70">
            <MessageCircle className="w-6 h-6" strokeWidth={1.7} />
          </div>
          <p className="text-white font-medium">Пока нет диалогов</p>
          <p className="text-sm text-white/60">Откройте профиль пользователя и нажмите “Отправить сообщение”.</p>
        </div>
      )}

      <div className="space-y-3">
        {items.map((chat) => {
          const preview = chat.last_message?.body?.trim() || "Начните диалог";
          return (
            <button
              key={chat.id}
              type="button"
              onClick={() => navigate(`/chats/${chat.id}`)}
              className="card w-full p-4 text-left hover:border-white/25 transition"
            >
              <div className="flex items-start gap-3">
                <AvatarCircle
                  src={chat.participant.avatar_url}
                  fallback={chat.participant.full_name || chat.participant.username}
                  className="w-12 h-12 text-base font-semibold"
                  alt={chat.participant.username}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-white font-semibold truncate inline-flex items-center gap-[3px]">
                        <span>{chat.participant.full_name}</span>
                        {chat.participant.is_verified ? <VerifiedBadge /> : null}
                      </p>
                      <p className="text-white/60 text-sm truncate">@{chat.participant.username}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      {chat.last_message_at && (
                        <p className="text-xs text-white/50">{timeAgo(chat.last_message_at)}</p>
                      )}
                      {chat.unread_count > 0 && (
                        <span className="mt-1 inline-flex min-w-[20px] h-5 px-1.5 items-center justify-center rounded-full bg-white text-black text-xs font-semibold">
                          {chat.unread_count > 99 ? "99+" : chat.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-sm text-white/70 line-clamp-2 break-words">{preview}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <div ref={sentinelRef} className="h-8 flex items-center justify-center">
        {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-white/60" />}
      </div>
    </main>
  );
}

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Reply, SendHorizontal, X } from "lucide-react";

import { api, type ChatMessage, type ChatPreview } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";

type UiMessage = ChatMessage & {
  pending?: boolean;
  failed?: boolean;
};

type ReplyDraft = {
  id: string;
  sender_id: string;
  body: string;
};

type ChatSocketEvent =
  | { type: "ready"; chat_id: string }
  | { type: "message_created"; chat_id: string; message: ChatMessage }
  | { type: "message.created"; chat_id: string; message: ChatMessage }
  | { type: "error"; message: string };

const toAsc = <T extends { created_at: string }>(items: T[]) =>
  [...items].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

const mergeMessages = (current: UiMessage[], incoming: ChatMessage[]) => {
  const byID = new Map<string, UiMessage>();
  current.forEach((m) => byID.set(m.id, m));
  incoming.forEach((m) => {
    const prev = byID.get(m.id);
    byID.set(m.id, { ...(prev || {}), ...m, pending: false, failed: false });
  });
  return toAsc(Array.from(byID.values()));
};

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const trimReplyPreview = (value: string, max = 120) => {
  const flat = (value || "").replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max).trimEnd()}...`;
};

const POLL_INTERVAL_MS = 5000;
const DEBUG_CHAT = true;

const chatWSURL = (chatId: string) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/chats/${encodeURIComponent(chatId)}/ws`;
};

const isIncomingMessageEvent = (
  evt: ChatSocketEvent
): evt is { type: "message_created" | "message.created"; chat_id: string; message: ChatMessage } =>
  evt.type === "message_created" || evt.type === "message.created";

const mergeIncomingMessage = (current: UiMessage[], incoming: ChatMessage) => {
  const incomingTs = new Date(incoming.created_at).getTime();
  const withoutMatchedPending = current.filter((m) => {
    if (!m.pending) return true;
    if ((m.body || "").trim() !== (incoming.body || "").trim()) return true;
    if ((m.reply_to_id || "") !== (incoming.reply_to_id || "")) return true;
    const pendingTs = new Date(m.created_at).getTime();
    return Math.abs(pendingTs - incomingTs) > 15000;
  });
  return mergeMessages(withoutMatchedPending, [incoming]);
};

const debugChat = (chatId: string, event: string, payload?: unknown) => {
  if (!DEBUG_CHAT) return;
  // eslint-disable-next-line no-console
  console.debug(`[chat:${chatId}] ${event}`, payload ?? "");
};

export default function ChatConversationPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();
  const { chatId = "" } = useParams();

  const [chat, setChat] = useState<ChatPreview | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pollInFlightRef = useRef(false);
  const autoScrollAfterRenderRef = useRef(false);
  const wsConnectedRef = useRef(false);
  const peerIDRef = useRef("");
  const markReadInFlightRef = useRef(false);
  const lastMarkReadAtRef = useRef(0);

  const peerID = chat?.participant?.id || "";
  const peerDisplayName = chat?.participant?.full_name || chat?.participant?.username || "собеседник";

  useEffect(() => {
    peerIDRef.current = peerID;
  }, [peerID]);

  const messageByID = useMemo(() => {
    const map = new Map<string, UiMessage>();
    messages.forEach((m) => map.set(m.id, m));
    return map;
  }, [messages]);

  const replyAuthorLabel = (senderID: string) => {
    if (senderID === peerID) return peerDisplayName;
    return "Вы";
  };

  const scrollToBottom = (behavior: ScrollBehavior = "auto") => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  };

  const scheduleAutoScrollToBottom = (reason: string, payload?: unknown) => {
    autoScrollAfterRenderRef.current = true;
    if (chatId) {
      debugChat(chatId, `autoscroll_scheduled:${reason}`, payload);
    }
  };

  const markReadSafe = () => {
    if (!token || !chatId) return;
    const now = Date.now();
    if (markReadInFlightRef.current) return;
    if (now - lastMarkReadAtRef.current < 1200) return;
    markReadInFlightRef.current = true;
    lastMarkReadAtRef.current = now;
    api
      .markChatRead(chatId, token)
      .catch(() => {})
      .finally(() => {
        markReadInFlightRef.current = false;
      });
  };

  const loadInitial = async () => {
    if (!token || !chatId) return;
    setLoading(true);
    try {
      const [chatRes, msgRes] = await Promise.all([
        api.chatById(chatId, token),
        api.chatMessages(chatId, 30, 0, token),
      ]);
      const initial = toAsc(msgRes.items);
      setChat(chatRes);
      setMessages(initial);
      setNextOffset(msgRes.nextOffset);
      setError("");

      requestAnimationFrame(() => {
        scrollToBottom("auto");
      });
      markReadSafe();
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить чат");
    } finally {
      setLoading(false);
    }
  };

  const loadOlder = async () => {
    if (!token || !chatId || nextOffset === null || loadingMore || loading) return;
    const el = listRef.current;
    const prevTop = el?.scrollTop ?? 0;
    const prevHeight = el?.scrollHeight ?? 0;

    setLoadingMore(true);
    try {
      const res = await api.chatMessages(chatId, 30, nextOffset, token);
      setMessages((prev) => mergeMessages(prev, toAsc(res.items)));
      setNextOffset(res.nextOffset);
      requestAnimationFrame(() => {
        const box = listRef.current;
        if (!box) return;
        const delta = box.scrollHeight - prevHeight;
        box.scrollTop = prevTop + delta;
      });
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить историю");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    loadInitial();
  }, [chatId, token]);

  useEffect(() => {
    setReplyTo(null);
  }, [chatId]);

  useEffect(() => {
    if (!autoScrollAfterRenderRef.current) return;
    autoScrollAfterRenderRef.current = false;
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      window.setTimeout(() => {
        const box = listRef.current;
        if (!box) return;
        box.scrollTop = box.scrollHeight;
      }, 60);
    });
  }, [messages]);

  useEffect(() => {
    if (!chatId) return;
    debugChat(chatId, "mount", { queryKey: ["chatMessages", chatId, "latest"] });
    return () => {
      debugChat(chatId, "unmount");
    };
  }, [chatId]);

  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();
    const top = topRef.current;
    if (!top || nextOffset === null || loading || loadingMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting) loadOlder();
      },
      { root: listRef.current, rootMargin: "120px 0px 0px 0px" }
    );
    observerRef.current.observe(top);
    return () => observerRef.current?.disconnect();
  }, [nextOffset, loading, loadingMore, token, chatId]);

  useEffect(() => {
    if (!token || !chatId) return;

    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;

    const reconnect = () => {
      if (stopped) return;
      const delay = Math.min(1000 * 2 ** attempts, 10000);
      attempts += 1;
      debugChat(chatId, "ws_schedule_reconnect", { delayMs: delay });
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (stopped) return;
      debugChat(chatId, "ws_connect_start");
      socket = new WebSocket(chatWSURL(chatId));

      socket.onopen = () => {
        debugChat(chatId, "ws_open", { queryKey: ["chatMessages", chatId, "latest"] });
        wsConnectedRef.current = true;
        socket?.send(
          JSON.stringify({
            type: "auth",
            token,
          })
        );
        attempts = 0;
        // Re-sync latest page after reconnect to avoid gaps.
        api
          .chatMessages(chatId, 30, 0, token)
          .then((res) => {
            if (stopped) return;
            setMessages((prev) => {
              const merged = mergeMessages(prev, toAsc(res.items));
              if (merged.length !== prev.length) {
                debugChat(chatId, "ws_resync_state_updated", {
                  before: prev.length,
                  after: merged.length,
                });
              }
              return merged;
            });
            setNextOffset((prev) => (prev === null ? res.nextOffset : prev));
          })
          .catch(() => {});
      };

      socket.onmessage = (evt) => {
        let parsed: ChatSocketEvent | null = null;
        try {
          parsed = JSON.parse(String(evt.data)) as ChatSocketEvent;
        } catch {
          return;
        }
        if (!parsed) return;

        if (parsed.type === "error" && parsed.message) {
          debugChat(chatId, "ws_error_event", parsed.message);
          setError(parsed.message);
          return;
        }

        if (isIncomingMessageEvent(parsed) && parsed.chat_id === chatId) {
          debugChat(chatId, "ws_message_received", {
            messageId: parsed.message.id,
            senderId: parsed.message.sender_id,
          });
          setMessages((prev) => {
            const merged = mergeIncomingMessage(prev, parsed.message);
            const prevLastID = prev.at(-1)?.id;
            const mergedLastID = merged.at(-1)?.id;
            if (mergedLastID && mergedLastID !== prevLastID) {
              scheduleAutoScrollToBottom("ws_new_message", {
                messageId: mergedLastID,
              });
            }
            debugChat(chatId, "ws_state_updated", {
              before: prev.length,
              after: merged.length,
              messageId: parsed.message.id,
            });
            return merged;
          });
          setChat((prev) =>
            prev
              ? {
                  ...prev,
                  last_message: {
                    id: parsed.message.id,
                    sender_id: parsed.message.sender_id,
                    body: parsed.message.body,
                    created_at: parsed.message.created_at,
                  },
                  last_message_at: parsed.message.created_at,
                }
              : prev
          );
          if (peerIDRef.current && parsed.message.sender_id === peerIDRef.current) {
            markReadSafe();
          }
        }
      };

      socket.onerror = () => {
        debugChat(chatId, "ws_error");
        socket?.close();
      };

      socket.onclose = () => {
        debugChat(chatId, "ws_close");
        wsConnectedRef.current = false;
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
      debugChat(chatId, "ws_cleanup");
      wsConnectedRef.current = false;
      socket?.close();
    };
  }, [token, chatId]);

  useEffect(() => {
    if (!token || !chatId) return;

    const runPoll = async () => {
      if (pollInFlightRef.current || loading || loadingMore) return;
      if (wsConnectedRef.current) return;
      if (document.visibilityState !== "visible") return;
      pollInFlightRef.current = true;
      try {
        const res = await api.chatMessages(chatId, 30, 0, token);
        setMessages((prev) => {
          const prevIDs = new Set(prev.map((m) => m.id));
          const merged = mergeMessages(prev, toAsc(res.items));
          let hasNewPeerMessage = false;
          const currentPeerID = peerIDRef.current;
          if (currentPeerID) {
            for (const m of merged) {
              if (!prevIDs.has(m.id) && m.sender_id === currentPeerID) {
                hasNewPeerMessage = true;
                break;
              }
            }
          }
          const prevLastID = prev.at(-1)?.id;
          const mergedLastID = merged.at(-1)?.id;
          if (mergedLastID && mergedLastID !== prevLastID) {
            scheduleAutoScrollToBottom("poll_new_message", {
              messageId: mergedLastID,
            });
          }
          if (hasNewPeerMessage) {
            markReadSafe();
          }
          if (merged.length !== prev.length) {
            debugChat(chatId, "poll_state_updated", {
              before: prev.length,
              after: merged.length,
              queryKey: ["chatMessages", chatId, "latest"],
            });
          }
          return merged;
        });
      } catch (e) {
        debugChat(chatId, "poll_error", e);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const id = window.setInterval(runPoll, POLL_INTERVAL_MS);
    debugChat(chatId, "poll_started", { intervalMs: POLL_INTERVAL_MS });
    return () => {
      window.clearInterval(id);
      debugChat(chatId, "poll_stopped");
    };
  }, [token, chatId, loading, loadingMore]);

  const sendMessage = async () => {
    if (!token || !chatId || sending) return;
    const text = body.trim();
    if (!text) return;
    const activeReply = replyTo;

    const tempID = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: UiMessage = {
      id: tempID,
      chat_id: chatId,
      sender_id: "me",
      reply_to_id: activeReply?.id,
      body: text,
      created_at: new Date().toISOString(),
      pending: true,
    };

    setBody("");
    setReplyTo(null);
    setMessages((prev) => toAsc([...prev, optimistic]));
    requestAnimationFrame(() => {
      scrollToBottom("smooth");
    });

    setSending(true);
    try {
      const saved = await api.sendChatMessage(chatId, text, token, activeReply?.id);
      setMessages((prev) => toAsc(prev.map((m) => (m.id === tempID ? { ...saved } : m))));
      setChat((prev) =>
        prev
          ? {
              ...prev,
              last_message: {
                id: saved.id,
                sender_id: saved.sender_id,
                body: saved.body,
                created_at: saved.created_at,
              },
              last_message_at: saved.created_at,
            }
          : prev
      );
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempID ? { ...m, pending: false, failed: true } : m))
      );
      setError(e.message || "Не удалось отправить сообщение");
    } finally {
      setSending(false);
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void sendMessage();
  };

  if (!loading && !chat) {
    return (
      <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-4 page-fade">
        <ErrorMessage message={error || "Чат не найден"} />
        <button
          type="button"
          onClick={() => navigate("/chats")}
          className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40 transition"
        >
          Назад к чатам
        </button>
      </main>
    );
  }

  return (
    <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-3 page-fade">
      <div className="card p-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/chats")}
          className="w-9 h-9 rounded-full border border-white/15 bg-white/5 hover:bg-white/10 text-white/80 grid place-items-center"
          aria-label="Назад"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        {chat ? (
          <>
            <AvatarCircle
              src={chat.participant.avatar_url}
              fallback={chat.participant.full_name || chat.participant.username}
              className="w-10 h-10 text-sm font-semibold"
              alt={chat.participant.username}
            />
            <div className="min-w-0">
              <p className="text-white font-semibold truncate">{chat.participant.full_name}</p>
              <p className="text-white/60 text-sm truncate">@{chat.participant.username}</p>
            </div>
          </>
        ) : (
          <div className="text-white/60 text-sm">Загрузка...</div>
        )}
      </div>

      <ErrorMessage message={error} />

      <div className="card overflow-hidden">
        <div ref={listRef} className="h-[62vh] md:h-[64vh] overflow-y-auto scrollbar-hide px-3 py-4 space-y-3">
          <div ref={topRef} className="h-6 flex items-center justify-center">
            {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-white/60" />}
          </div>

          {loading && (
            <div className="space-y-2 animate-pulse">
              <div className="ml-auto h-12 w-2/3 rounded-2xl bg-white/10" />
              <div className="h-12 w-2/3 rounded-2xl bg-white/10" />
              <div className="ml-auto h-10 w-1/2 rounded-2xl bg-white/10" />
            </div>
          )}

          {!loading && messages.length === 0 && (
            <div className="h-full min-h-[240px] flex items-center justify-center text-white/60 text-sm">
              Сообщений пока нет. Начните диалог.
            </div>
          )}

          {messages.map((m) => {
            const mine = peerID ? m.sender_id !== peerID : m.sender_id === "me";
            const repliedMessage = m.reply_to_id ? messageByID.get(m.reply_to_id) : undefined;
            const replyPreview = repliedMessage ? trimReplyPreview(repliedMessage.body, 90) : "Сообщение";
            const replyPreviewAuthor = repliedMessage ? replyAuthorLabel(repliedMessage.sender_id) : "Ответ";
            return (
              <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`group flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                  <button
                    type="button"
                    disabled={m.pending}
                    onClick={() =>
                      setReplyTo({
                        id: m.id,
                        sender_id: m.sender_id,
                        body: m.body,
                      })
                    }
                    className={`h-8 w-8 shrink-0 rounded-full border transition ${
                      mine
                        ? "border-black/15 bg-white/80 text-black hover:bg-white"
                        : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    aria-label="Ответить"
                    title="Ответить"
                  >
                    <Reply className="w-3.5 h-3.5 mx-auto" />
                  </button>
                  <div
                    className={`max-w-[78%] rounded-2xl px-3 py-2 break-words whitespace-pre-wrap ${
                      mine
                        ? "bg-white text-black"
                        : "bg-white/10 text-white border border-white/10"
                    }`}
                  >
                    {m.reply_to_id && (
                      <div
                        className={`mb-2 rounded-xl border px-2 py-1.5 ${
                          mine
                            ? "border-black/15 bg-black/10 text-black/80"
                            : "border-white/15 bg-black/30 text-white/80"
                        }`}
                      >
                        <p className="text-[11px] font-semibold leading-tight">{replyPreviewAuthor}</p>
                        <p className={`text-xs leading-tight ${mine ? "text-black/70" : "text-white/70"}`}>
                          {replyPreview}
                        </p>
                      </div>
                    )}
                    <p className="text-sm leading-relaxed">{m.body}</p>
                    <div className={`mt-1 text-[11px] ${mine ? "text-black/60" : "text-white/50"}`}>
                      {timeLabel(m.created_at)}
                      {m.pending && " · отправка..."}
                      {m.failed && " · ошибка"}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={onSubmit} className="border-t border-white/10 p-3 space-y-2">
          {replyTo && (
            <div className="rounded-xl border border-white/15 bg-white/5 px-3 py-2 flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-white/60">Ответ на {replyAuthorLabel(replyTo.sender_id)}</p>
                <p className="text-xs text-white/90 truncate">{trimReplyPreview(replyTo.body, 140)}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="h-6 w-6 rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 grid place-items-center"
                aria-label="Убрать reply"
                title="Убрать reply"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="Напишите сообщение..."
              rows={1}
              className="flex-1 h-12 resize-none overflow-y-auto rounded-xl border border-white/10 bg-black/40 px-3 py-3 text-white text-sm leading-5 placeholder:text-white/35 focus:outline-none focus:border-white/30"
            />
            <button
              type="submit"
              disabled={sending || body.trim().length === 0}
              className="nav-icon shrink-0 self-center bg-white/10 text-white/60 hover:bg-white/20 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="send"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <SendHorizontal className="w-5 h-5" />}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}

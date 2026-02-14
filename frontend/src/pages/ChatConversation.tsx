import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Paperclip, Reply, SendHorizontal, X } from "lucide-react";

import { api, type ChatMessage, type ChatMessageAttachment, type ChatPreview } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";
import { MediaViewerModal } from "../components/MediaViewerModal";
import { VerifiedBadge } from "../components/VerifiedBadge";

type UiMessage = ChatMessage & {
  pending?: boolean;
  failed?: boolean;
};

type ComposerAttachment = {
  id: string;
  file: File;
  previewUrl: string;
  status: "uploading" | "uploaded" | "error";
  uploaded?: ChatMessageAttachment;
  error?: string;
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
const MAX_CHAT_ATTACHMENTS = 5;
const MAX_CHAT_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const HEIC_MIME_SET = new Set([
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const isHeicOrHeifFile = (file: File) => {
  const type = String(file.type || "").toLowerCase();
  if (HEIC_MIME_SET.has(type)) return true;
  if (type.includes("heic") || type.includes("heif")) return true;
  const name = String(file.name || "").trim().toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif");
};

const attachmentSignature = (msg: { attachments?: ChatMessageAttachment[] }) =>
  (msg.attachments || [])
    .map((a) => `${a.url}|${a.width}|${a.height}|${a.type}`)
    .join("||");

const chatWSURL = (chatId: string) => {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}/api/chats/${encodeURIComponent(chatId)}/ws`;
};

const isIncomingMessageEvent = (
  evt: ChatSocketEvent
): evt is { type: "message_created" | "message.created"; chat_id: string; message: ChatMessage } =>
  evt.type === "message_created" || evt.type === "message.created";

const mergeIncomingMessage = (current: UiMessage[], incoming: ChatMessage) => {
  const incomingAttachmentSig = attachmentSignature(incoming);
  const incomingTs = new Date(incoming.created_at).getTime();
  const withoutMatchedPending = current.filter((m) => {
    if (!m.pending) return true;
    if ((m.body || "").trim() !== (incoming.body || "").trim()) return true;
    if ((m.reply_to_id || "") !== (incoming.reply_to_id || "")) return true;
    if (attachmentSignature(m) !== incomingAttachmentSig) return true;
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
  const [mediaError, setMediaError] = useState("");
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [viewer, setViewer] = useState<{ urls: string[]; initialIndex: number } | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const pollInFlightRef = useRef(false);
  const autoScrollAfterRenderRef = useRef(false);
  const initialAutoScrolledChatRef = useRef("");
  const wsConnectedRef = useRef(false);
  const peerIDRef = useRef("");
  const markReadInFlightRef = useRef(false);
  const lastMarkReadAtRef = useRef(0);
  const composerAttachmentsRef = useRef<ComposerAttachment[]>([]);
  const mediaErrorTimerRef = useRef<number | null>(null);

  const peerID = chat?.participant?.id || "";
  const peerDisplayName = chat?.participant?.full_name || chat?.participant?.username || "собеседник";

  useEffect(() => {
    const media = window.matchMedia("(max-width: 870px)");
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverscroll = html.style.overscrollBehaviorY;
    const prevBodyOverscroll = body.style.overscrollBehaviorY;

    const updateLock = () => {
      if (media.matches) {
        html.style.overflow = "hidden";
        body.style.overflow = "hidden";
        html.style.overscrollBehaviorY = "none";
        body.style.overscrollBehaviorY = "none";
      } else {
        html.style.overflow = prevHtmlOverflow;
        body.style.overflow = prevBodyOverflow;
        html.style.overscrollBehaviorY = prevHtmlOverscroll;
        body.style.overscrollBehaviorY = prevBodyOverscroll;
      }
    };

    updateLock();
    const unsubscribe =
      typeof media.addEventListener === "function"
        ? (() => {
            media.addEventListener("change", updateLock);
            return () => media.removeEventListener("change", updateLock);
          })()
        : (() => {
            media.addListener(updateLock);
            return () => media.removeListener(updateLock);
          })();
    return () => {
      unsubscribe();
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
      html.style.overscrollBehaviorY = prevHtmlOverscroll;
      body.style.overscrollBehaviorY = prevBodyOverscroll;
    };
  }, []);

  useEffect(() => {
    peerIDRef.current = peerID;
  }, [peerID]);

  useEffect(() => {
    composerAttachmentsRef.current = composerAttachments;
  }, [composerAttachments]);

  useEffect(() => {
    return () => {
      composerAttachmentsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
      });
      if (mediaErrorTimerRef.current !== null) {
        window.clearTimeout(mediaErrorTimerRef.current);
      }
    };
  }, []);

  const showMediaError = (message: string) => {
    setMediaError(message);
    if (mediaErrorTimerRef.current !== null) {
      window.clearTimeout(mediaErrorTimerRef.current);
    }
    mediaErrorTimerRef.current = window.setTimeout(() => {
      setMediaError("");
      mediaErrorTimerRef.current = null;
    }, 3200);
  };

  const clearComposerAttachments = () => {
    setComposerAttachments((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  };

  const removeComposerAttachment = (id: string) => {
    setComposerAttachments((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const uploadComposerAttachment = async (id: string, file: File) => {
    if (!token) {
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.id === id
            ? { ...item, status: "error", error: "Сначала авторизуйся" }
            : item
        )
      );
      return;
    }

    try {
      const uploaded = await api.uploadMedia([file], "chat", token);
      const first = uploaded[0];
      if (!first?.url) {
        throw new Error("upload_failed");
      }
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "uploaded",
                uploaded: {
                  url: first.url,
                  width: Number(first.width) || 0,
                  height: Number(first.height) || 0,
                  type: "image",
                },
                error: undefined,
              }
            : item
        )
      );
    } catch (e: any) {
      const msg = e?.message || "Не удалось загрузить файл";
      setComposerAttachments((prev) =>
        prev.map((item) =>
          item.id === id
            ? {
                ...item,
                status: "error",
                error: msg,
              }
            : item
        )
      );
      showMediaError(msg);
    }
  };

  const handleAttachFiles = (files: FileList | null) => {
    if (!files) return;

    const incoming = Array.from(files);
    const allowed: ComposerAttachment[] = [];
    const existingCount = composerAttachmentsRef.current.length;
    let rejected = false;
    let hasSizeError = false;
    let hasTypeError = false;
    let hasHeicError = false;

    for (const file of incoming) {
      const type = String(file.type || "").toLowerCase();
      if (existingCount + allowed.length >= MAX_CHAT_ATTACHMENTS) {
        rejected = true;
        break;
      }
      if (isHeicOrHeifFile(file)) {
        rejected = true;
        hasHeicError = true;
        continue;
      }
      if (!type.startsWith("image/") || type === "image/svg+xml") {
        rejected = true;
        hasTypeError = true;
        continue;
      }
      if (file.size <= 0 || file.size > MAX_CHAT_ATTACHMENT_BYTES) {
        rejected = true;
        hasSizeError = true;
        continue;
      }

      allowed.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
        status: "uploading",
      });
    }

    if (rejected) {
      if (hasHeicError) {
        showMediaError("Формат HEIC/HEIF не поддерживается. Выберите JPG, PNG, WebP или GIF.");
      } else if (hasSizeError) {
        showMediaError("Максимальный размер файла 5MB.");
      } else if (hasTypeError) {
        showMediaError("Разрешены только изображения и GIF.");
      } else {
        showMediaError("Можно прикрепить максимум 5 изображений в одном сообщении.");
      }
    }

    if (allowed.length === 0) return;

    setComposerAttachments((prev) => [...prev, ...allowed]);
    allowed.forEach((item) => {
      void uploadComposerAttachment(item.id, item.file);
    });
  };

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
    initialAutoScrolledChatRef.current = "";
    setViewer(null);
    setMediaError("");
    setComposerAttachments((prev) => {
      prev.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      return [];
    });
  }, [chatId]);

  useEffect(() => {
    if (!chatId || loading || messages.length === 0) return;
    if (initialAutoScrolledChatRef.current === chatId) return;
    initialAutoScrolledChatRef.current = chatId;
    debugChat(chatId, "autoscroll_initial_open", { messageCount: messages.length });

    requestAnimationFrame(() => {
      scrollToBottom("auto");
      window.setTimeout(() => scrollToBottom("auto"), 60);
      window.setTimeout(() => scrollToBottom("auto"), 180);
    });
  }, [chatId, loading, messages.length]);

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
    const activeComposerAttachments = composerAttachmentsRef.current;
    const hasUploadingAttachments = activeComposerAttachments.some((a) => a.status === "uploading");
    if (hasUploadingAttachments) {
      setError("Дождитесь завершения загрузки вложений.");
      return;
    }
    const hasFailedAttachments = activeComposerAttachments.some((a) => a.status === "error");
    if (hasFailedAttachments) {
      setError("Есть вложения с ошибкой. Удалите их или загрузите заново.");
      return;
    }
    const uploadedAttachments = activeComposerAttachments
      .filter((a): a is ComposerAttachment & { uploaded: ChatMessageAttachment } => a.status === "uploaded" && !!a.uploaded)
      .map((a) => a.uploaded);

    if (!text && uploadedAttachments.length === 0) return;
    const activeReply = replyTo;

    const tempID = `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const optimistic: UiMessage = {
      id: tempID,
      chat_id: chatId,
      sender_id: "me",
      reply_to_id: activeReply?.id,
      body: text,
      attachments: uploadedAttachments,
      created_at: new Date().toISOString(),
      pending: true,
    };

    setError("");
    setBody("");
    setReplyTo(null);
    clearComposerAttachments();
    setMessages((prev) => toAsc([...prev, optimistic]));
    requestAnimationFrame(() => {
      scrollToBottom("smooth");
    });

    setSending(true);
    try {
      const saved = await api.sendChatMessage(chatId, text, token, activeReply?.id, uploadedAttachments);
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

  const hasUploadingComposer = composerAttachments.some((item) => item.status === "uploading");
  const hasFailedComposer = composerAttachments.some((item) => item.status === "error");
  const hasUploadedComposer = composerAttachments.some((item) => item.status === "uploaded" && !!item.uploaded);
  const canSend = !sending && !hasUploadingComposer && !hasFailedComposer && (body.trim().length > 0 || hasUploadedComposer);

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
    <main
      data-page-root
      className="max-w-[672px] w-full mx-auto h-full py-3 min-[871px]:py-6 space-y-3 page-fade flex flex-col overflow-hidden min-[871px]:overflow-visible"
    >
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
              <p className="text-white font-semibold truncate inline-flex items-center gap-[3px]">
                <span>{chat.participant.full_name}</span>
                {chat.participant.is_verified ? <VerifiedBadge /> : null}
              </p>
              <p className="text-white/60 text-sm truncate">@{chat.participant.username}</p>
            </div>
          </>
        ) : (
          <div className="text-white/60 text-sm">Загрузка...</div>
        )}
      </div>

      <ErrorMessage message={error} />

      <div className="card overflow-hidden flex-1 min-h-0 flex flex-col">
        <div
          ref={listRef}
          className="flex-1 min-h-0 min-[871px]:h-[64vh] min-[871px]:flex-none overflow-y-auto scrollbar-hide px-3 py-4 space-y-3"
        >
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
            const messageAttachments = (m.attachments || []).filter((att) => String(att.url || "").trim() !== "");
            const hasBody = (m.body || "").trim().length > 0;
            const attachmentUrls = messageAttachments.map((att) => att.url);
            const isMultiAttachment = messageAttachments.length > 1;
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
                        ? "border-sky-500/40 bg-sky-500/25 text-sky-100 hover:bg-sky-500/35"
                        : "border-white/15 bg-white/5 text-white/70 hover:bg-white/10 hover:text-white"
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                    aria-label="Ответить"
                    title="Ответить"
                  >
                    <Reply className="w-3.5 h-3.5 mx-auto" />
                  </button>
                  <div
                    className={`${
                      messageAttachments.length > 0
                        ? "w-[min(78vw,28rem)] max-w-[28rem]"
                        : "max-w-[78%]"
                    } rounded-2xl px-3 py-2 break-words whitespace-pre-wrap ${
                      mine
                        ? "bg-[#1f5fbf] text-white border border-[#2b6fd1]"
                        : "bg-white/10 text-white border border-white/10"
                    }`}
                  >
                    {m.reply_to_id && (
                      <div
                        className={`mb-2 rounded-xl border px-2 py-1.5 ${
                          mine
                            ? "border-white/20 bg-black/15 text-white/90"
                            : "border-white/15 bg-black/30 text-white/80"
                        }`}
                      >
                        <p className="text-[11px] font-semibold leading-tight">{replyPreviewAuthor}</p>
                        <p className={`text-xs leading-tight ${mine ? "text-white/80" : "text-white/70"}`}>
                          {replyPreview}
                        </p>
                      </div>
                    )}
                    {messageAttachments.length > 0 && (
                      <div
                        className={`grid w-full gap-2 ${
                          isMultiAttachment ? "grid-cols-2" : "grid-cols-1"
                        } ${hasBody ? "mb-2" : ""}`}
                      >
                        {messageAttachments.map((att, idx) => (
                          <button
                            type="button"
                            key={`${m.id}-attachment-${idx}`}
                            onClick={() => setViewer({ urls: attachmentUrls, initialIndex: idx })}
                            className={`w-full overflow-hidden rounded-xl border focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${
                              mine ? "border-black/15 bg-black/10" : "border-white/15 bg-black/30"
                            }`}
                            aria-label={`Открыть вложение ${idx + 1}`}
                          >
                            <img
                              src={att.url}
                              alt="attachment"
                              className={`w-full bg-black/20 ${
                                isMultiAttachment ? "h-44 object-cover" : "max-h-[420px] h-auto object-contain"
                              }`}
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {hasBody && <p className="text-sm leading-relaxed">{m.body}</p>}
                    <div
                      className={`mt-1 text-[11px] ${
                        mine ? "text-right text-white/70" : "text-left text-white/50"
                      }`}
                    >
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
          <ErrorMessage message={mediaError} />
          {composerAttachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {composerAttachments.map((item, idx) => {
                const previewUrls = composerAttachments.map((x) => x.previewUrl);
                return (
                  <div
                    key={item.id}
                    className="relative h-16 w-16 overflow-hidden rounded-xl border border-white/15 bg-black/30"
                  >
                    <button
                      type="button"
                      onClick={() => setViewer({ urls: previewUrls, initialIndex: idx })}
                      className="h-full w-full"
                      aria-label={`Открыть выбранное изображение ${idx + 1}`}
                    >
                      <img
                        src={item.previewUrl}
                        alt="selected attachment"
                        className="h-full w-full object-cover"
                      />
                    </button>
                    {item.status === "uploading" && (
                      <div className="absolute inset-0 bg-black/55 grid place-items-center">
                        <Loader2 className="w-4 h-4 animate-spin text-white/80" />
                      </div>
                    )}
                    {item.status === "error" && (
                      <div className="absolute inset-0 bg-red-500/35 grid place-items-center px-1">
                        <span className="text-[10px] text-white text-center leading-tight">Ошибка</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => removeComposerAttachment(item.id)}
                      className="absolute top-1 right-1 h-5 w-5 rounded-full border border-white/20 bg-black/70 text-white/90 hover:bg-black"
                      aria-label="Удалить вложение"
                    >
                      <X className="w-3 h-3 mx-auto" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="nav-icon shrink-0 self-center bg-white/10 text-white/60 hover:bg-white/20 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="attach"
              disabled={composerAttachments.length >= MAX_CHAT_ATTACHMENTS || sending}
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".jpg,.jpeg,.png,.webp,.gif,image/*,image/gif"
              multiple
              className="hidden"
              onChange={(e) => {
                handleAttachFiles(e.target.files);
                e.target.value = "";
              }}
            />
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
              disabled={!canSend}
              className="nav-icon shrink-0 self-center bg-white/10 text-white/60 hover:bg-white/20 hover:text-white disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="send"
            >
              {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : <SendHorizontal className="w-5 h-5" />}
            </button>
          </div>
          {(hasUploadingComposer || hasFailedComposer) && (
            <p className="text-[11px] text-white/55">
              {hasUploadingComposer
                ? "Загрузка вложений..."
                : "Есть вложения с ошибкой. Удалите их перед отправкой."}
            </p>
          )}
        </form>
      </div>
      {viewer && (
        <MediaViewerModal
          urls={viewer.urls}
          initialIndex={viewer.initialIndex}
          onClose={() => setViewer(null)}
        />
      )}
    </main>
  );
}

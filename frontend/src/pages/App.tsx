import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import FeedPage from "./Feed";
import LoginPage from "./Login";
import RegisterPage from "./Register";
import Placeholder from "./Placeholder";
import ProfilePage from "./Profile";
import ProfileUserPage from "./ProfileUser";
import SearchPage from "./Search";
import NotificationsPage from "./Notifications";
import ChatsPage from "./Chats";
import ChatConversationPage from "./ChatConversation";
import PostPermalinkPage from "./PostPermalink";
import AdminPage from "./Admin";
import ModerationPage from "./Moderation";
import ModerationReportsPage from "./ModerationReports";
import ModerationLogsPage from "./ModerationLogs";
import { useAuthStore } from "../store/auth";
import Navigation from "../ui/Navigation";
import { useNotificationStore } from "../store/notifications";
import { useChatStore } from "../store/chats";
import { api } from "../api/client";
import { AuthGateOverlay } from "../components/AuthGateOverlay";
import { AuthGateModal } from "../components/AuthGateModal";
import { ProfileSkeleton } from "../components/ProfileSkeleton";
import { SearchSkeleton } from "../components/SearchSkeleton";
import { NotificationsSkeleton } from "../components/NotificationsSkeleton";
import { PostPermalinkSkeleton } from "../components/PostPermalinkSkeleton";

function isJwtExpired(token: string, skewSeconds = 10): boolean {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return true;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64Url.length + 3) % 4);
    const json = atob(base64);
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== "number") return true;
    const nowSec = Math.floor(Date.now() / 1000);
    return nowSec >= payload.exp - skewSeconds;
  } catch {
    return true;
  }
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const setChatsUnreadCount = useChatStore((s) => s.setUnreadCount);
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthed = !!token && !isJwtExpired(token);
  const isChatConversationPage = /^\/chats\/[^/]+$/.test(location.pathname);
  const [chatViewportHeight, setChatViewportHeight] = useState<number | null>(null);
  const telegramChannelUrl = "https://t.me/+vcgFlt-a5Dw0Y2Yy";

  useEffect(() => {
    if (!isChatConversationPage) {
      setChatViewportHeight(null);
      return;
    }

    const viewport = window.visualViewport;
    let rafID: number | null = null;
    let delayedA: number | null = null;
    let delayedB: number | null = null;

    const applyHeight = () => {
      const nextHeight = Math.round(
        viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0
      );
      if (!nextHeight) return;
      setChatViewportHeight((prev) => (prev === nextHeight ? prev : nextHeight));
      if (window.innerWidth < 871 && window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    };

    const scheduleApply = () => {
      if (rafID !== null) window.cancelAnimationFrame(rafID);
      rafID = window.requestAnimationFrame(() => {
        rafID = null;
        applyHeight();
      });
    };

    const scheduleApplyWithDelay = () => {
      scheduleApply();
      if (delayedA !== null) window.clearTimeout(delayedA);
      if (delayedB !== null) window.clearTimeout(delayedB);
      delayedA = window.setTimeout(scheduleApply, 45);
      delayedB = window.setTimeout(scheduleApply, 120);
    };

    scheduleApplyWithDelay();
    viewport?.addEventListener("resize", scheduleApplyWithDelay);
    viewport?.addEventListener("scroll", scheduleApplyWithDelay);
    window.addEventListener("resize", scheduleApplyWithDelay);
    window.addEventListener("orientationchange", scheduleApplyWithDelay);
    window.addEventListener("focus", scheduleApplyWithDelay);
    window.addEventListener("pageshow", scheduleApplyWithDelay);
    document.addEventListener("visibilitychange", scheduleApplyWithDelay);
    document.addEventListener("focusin", scheduleApplyWithDelay);
    document.addEventListener("focusout", scheduleApplyWithDelay);

    return () => {
      viewport?.removeEventListener("resize", scheduleApplyWithDelay);
      viewport?.removeEventListener("scroll", scheduleApplyWithDelay);
      window.removeEventListener("resize", scheduleApplyWithDelay);
      window.removeEventListener("orientationchange", scheduleApplyWithDelay);
      window.removeEventListener("focus", scheduleApplyWithDelay);
      window.removeEventListener("pageshow", scheduleApplyWithDelay);
      document.removeEventListener("visibilitychange", scheduleApplyWithDelay);
      document.removeEventListener("focusin", scheduleApplyWithDelay);
      document.removeEventListener("focusout", scheduleApplyWithDelay);
      if (rafID !== null) window.cancelAnimationFrame(rafID);
      if (delayedA !== null) window.clearTimeout(delayedA);
      if (delayedB !== null) window.clearTimeout(delayedB);
    };
  }, [isChatConversationPage]);

  const chatViewportStyle: CSSProperties | undefined =
    isChatConversationPage && chatViewportHeight
      ? ({ "--chat-mobile-vh": `${chatViewportHeight}px` } as CSSProperties)
      : undefined;

  // If the token is expired/invalid, clear it so the app behaves as logged out.
  // We still rely on backend 401/403 for security.
  useEffect(() => {
    if (token && !isAuthed) {
      setToken(null);
    }
  }, [token, isAuthed, setToken]);

  // If token is present but invalid for backend (e.g. JWT_SECRET changed),
  // clear it early so UI doesn't show "logged in" controls incorrectly.
  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    api
      .profileMe(token)
      .then(() => {
        // ok
      })
      .catch(() => {
        // request() already clears token on 401; ignore other errors silently
        if (cancelled) return;
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Глобальная инициализация индикатора уведомлений
  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setUnreadCount(0);
      return;
    }
    api
      .notificationsUnread(token)
      .then((res) => {
        if (!cancelled) setUnreadCount(res.unread_count || 0);
      })
      .catch(() => {
        // тихо игнорируем, чтобы не мешать остальному UI
      });
    return () => {
      cancelled = true;
    };
  }, [token, setUnreadCount]);

  useEffect(() => {
    if (!token) {
      setChatsUnreadCount(0);
      return;
    }

    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let attempts = 0;

    const refreshUnread = async () => {
      try {
        const res = await api.chatsUnread(token);
        if (!cancelled) setChatsUnreadCount(res.unread_count || 0);
      } catch {
        // silent: chat badge is non-critical indicator
      }
    };

    const reconnect = () => {
      if (cancelled) return;
      const delay = Math.min(1000 * 2 ** attempts, 10000);
      attempts += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (cancelled) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/api/chats/ws`);

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
        try {
          const parsed = JSON.parse(String(evt.data)) as { type?: string };
          if (parsed?.type === "chat_list_updated") {
            void refreshUnread();
          }
        } catch {
          // ignore malformed frames
        }
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (cancelled) return;
        reconnect();
      };
    };

    void refreshUnread();
    connect();

    const pollID = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshUnread();
    }, 30000);
    const onFocus = () => {
      void refreshUnread();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      window.clearInterval(pollID);
      window.removeEventListener("focus", onFocus);
      socket?.close();
    };
  }, [token, setChatsUnreadCount]);

  const items = [
    { label: "Лента", path: "/" , icon: "feed"},
    { label: "Поиск", path: "/search", icon: "search"},
    { label: "Чаты", path: "/chats", icon: "messages"},
    { label: "Уведомления", path: "/notifications", icon: "bell"},
    { label: "Telegram", path: telegramChannelUrl, icon: "telegram" },
    { label: "Профиль", path: "/profile", icon: "user"},
    isAuthed
      ? { label: "Выйти", path: "/logout", icon: "exit" }
      : { label: "Вход", path: "/login", icon: "login" },
  ].filter(Boolean) as { label: string; path: string; icon: string }[];

  const handleTabClick = (path: string) => {
    if (path.startsWith("https://") || path.startsWith("http://")) {
      window.open(path, "_blank", "noopener,noreferrer");
      return;
    }
    if (path === "/logout") {
      setToken(null);
      navigate("/login");
    } else {
      navigate(path);
    }
  };

  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";

  return (
    <div className="min-h-screen bg-black text-white relative">
      {!isAuthPage && (
        <Navigation
          items={items}
          onClick={handleTabClick}
          activePath={location.pathname}
          hideMobileBottomBar={isChatConversationPage}
        />
      )}
      <AuthGateModal />
      <div className="mx-auto max-w-6xl px-3 md:px-8">
        <div
          key={location.pathname}
          style={chatViewportStyle}
          className={
            isChatConversationPage
              ? "h-[var(--chat-mobile-vh,100dvh)] overflow-hidden pb-0 min-[871px]:h-auto min-[871px]:overflow-visible min-[871px]:pb-6"
              : "pb-[calc(5rem+env(safe-area-inset-bottom))] min-[871px]:pb-6"
          }
        >
          <Routes location={location}>
            <Route
              path="/"
              element={<FeedPage />}
            />
            <Route
              path="/search"
              element={
                isAuthed ? (
                  <SearchPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Поиск доступен только после входа."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <SearchSkeleton />
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/notifications"
              element={
                isAuthed ? (
                  <NotificationsPage />
              ) : (
                <AuthGateOverlay
                  mode="page"
                  title="Сначала авторизуйся"
                  message="Уведомления доступны только после входа."
                  ctaLabel="Войти"
                  className="min-h-[calc(100vh-9rem)]"
                >
                  <NotificationsSkeleton />
                </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/chats"
              element={
                isAuthed ? (
                  <ChatsPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Чаты доступны только после входа."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <NotificationsSkeleton />
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/chats/:chatId"
              element={
                isAuthed ? (
                  <ChatConversationPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Чаты доступны только после входа."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <NotificationsSkeleton />
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/profile"
              element={
                isAuthed ? (
                  <ProfilePage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Профиль доступен только после входа."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
                      <ProfileSkeleton />
                    </div>
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/u/:username"
              element={
                isAuthed ? (
                  <ProfileUserPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Чтобы открыть профиль, нужно войти."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
                      <ProfileSkeleton />
                    </div>
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/p/:id"
              element={
                isAuthed ? (
                  <PostPermalinkPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Чтобы открыть пост по ссылке, нужно войти."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <PostPermalinkSkeleton />
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/admin"
              element={
                isAuthed ? (
                  <AdminPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Доступ в админ-панель возможен только после входа."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
                      <ProfileSkeleton />
                    </div>
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/moderation"
              element={
                isAuthed ? (
                  <ModerationPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Доступ к модерации возможен только после входа."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
                      <ProfileSkeleton />
                    </div>
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/moderation/reports"
              element={
                isAuthed ? (
                  <ModerationReportsPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Доступ к жалобам возможен только после входа."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
                      <ProfileSkeleton />
                    </div>
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/moderation/logs"
              element={
                isAuthed ? (
                  <ModerationLogsPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title="Сначала авторизуйся"
                    message="Доступ к логам модерации возможен только после входа."
                    ctaLabel="Войти"
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
                      <ProfileSkeleton />
                    </div>
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/login"
              element={isAuthed ? <Navigate to="/" replace /> : <LoginPage />}
            />
            <Route
              path="/register"
              element={isAuthed ? <Navigate to="/" replace /> : <RegisterPage />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

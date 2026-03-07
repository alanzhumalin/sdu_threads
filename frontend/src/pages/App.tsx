import { useEffect, useLayoutEffect, useState } from "react";
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
import RoomsPage from "./Rooms";
import RoomCallPage from "./RoomCall";
import PostPermalinkPage from "./PostPermalink";
import GiftCreatePage from "./GiftCreate";
import GiftViewPage from "./GiftView";
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
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { useI18n } from "../i18n";

const GIFT_FLAT_RESERVED_SEGMENTS = new Set([
  "gift",
  "login",
  "register",
  "logout",
  "search",
  "notifications",
  "chats",
  "rooms",
  "profile",
  "admin",
  "moderation",
  "u",
  "p",
  "api",
  "healthz",
]);

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
  const { t } = useI18n();
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const setUnreadCount = useNotificationStore((s) => s.setUnreadCount);
  const setChatsUnreadCount = useChatStore((s) => s.setUnreadCount);
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthed = !!token && !isJwtExpired(token);
  const flatGiftMatch = location.pathname.match(/^\/([^/]+)\/?$/);
  const flatGiftSlug = flatGiftMatch?.[1]?.toLowerCase() || "";
  const isFlatGiftViewPage = !!flatGiftSlug && !GIFT_FLAT_RESERVED_SEGMENTS.has(flatGiftSlug);
  const isChatConversationPage = /^\/chats\/[^/]+$/.test(location.pathname);
  const isRoomCallPage = /^\/rooms\/[^/]+$/.test(location.pathname);
  const isGiftPage = /^\/gift(\/|$)/.test(location.pathname) || isFlatGiftViewPage;
  const isGiftViewPage = /^\/gift\/(?!create$)[^/]+$/.test(location.pathname) || isFlatGiftViewPage;
  const isFullscreenMobilePage = isChatConversationPage || isRoomCallPage;
  const [chatViewportHeight, setChatViewportHeight] = useState<number | null>(null);
  const telegramChannelUrl = "https://t.me/+vcgFlt-a5Dw0Y2Yy";

  useLayoutEffect(() => {
    if (!isFullscreenMobilePage) {
      setChatViewportHeight(null);
      return;
    }

    const viewport = window.visualViewport;
    let rafID: number | null = null;
    let burstRafID: number | null = null;
    let burstUntilMs = 0;
    let forceLayoutHeightUntilMs = 0;
    let dismissSyncTimerA: number | null = null;
    let dismissSyncTimerB: number | null = null;
    let dismissSyncTimerC: number | null = null;

    const isEditableElement = (el: Element | null): boolean => {
      if (!(el instanceof HTMLElement)) return false;
      if (el.isContentEditable) return true;
      const tagName = el.tagName;
      if (tagName === "TEXTAREA") return true;
      if (tagName !== "INPUT") return false;
      const input = el as HTMLInputElement;
      const t = String(input.type || "text").toLowerCase();
      return !["button", "checkbox", "color", "file", "image", "radio", "range", "reset", "submit"].includes(t);
    };

    const clearDismissTimers = () => {
      if (dismissSyncTimerA !== null) {
        window.clearTimeout(dismissSyncTimerA);
        dismissSyncTimerA = null;
      }
      if (dismissSyncTimerB !== null) {
        window.clearTimeout(dismissSyncTimerB);
        dismissSyncTimerB = null;
      }
      if (dismissSyncTimerC !== null) {
        window.clearTimeout(dismissSyncTimerC);
        dismissSyncTimerC = null;
      }
    };

    const applyHeight = () => {
      const viewportHeight = Math.round(viewport?.height || 0);
      const layoutHeight = Math.round(window.innerHeight || document.documentElement.clientHeight || 0);
      const activeElement = document.activeElement as Element | null;
      const shouldPreferLayoutHeight =
        window.innerWidth < 871 &&
        !isEditableElement(activeElement) &&
        layoutHeight > 0 &&
        (Date.now() < forceLayoutHeightUntilMs || layoutHeight - viewportHeight > 120);
      const nextHeight = shouldPreferLayoutHeight
        ? layoutHeight
        : Math.round(viewportHeight || layoutHeight || 0);
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

    const startBurstSync = () => {
      burstUntilMs = Date.now() + 260;
      if (burstRafID !== null) return;
      const tick = () => {
        applyHeight();
        if (Date.now() < burstUntilMs) {
          burstRafID = window.requestAnimationFrame(tick);
        } else {
          burstRafID = null;
        }
      };
      burstRafID = window.requestAnimationFrame(tick);
    };

    const syncImmediately = () => {
      applyHeight();
      scheduleApply();
      startBurstSync();
    };

    const syncLight = () => {
      applyHeight();
      scheduleApply();
    };

    const syncAfterKeyboardDismiss = () => {
      forceLayoutHeightUntilMs = Date.now() + 480;
      clearDismissTimers();
      syncImmediately();
      dismissSyncTimerA = window.setTimeout(syncImmediately, 70);
      dismissSyncTimerB = window.setTimeout(syncImmediately, 170);
      dismissSyncTimerC = window.setTimeout(syncImmediately, 300);
    };

    const onFocusOut = (evt: FocusEvent) => {
      if (window.innerWidth >= 871) return;
      const target = evt.target as Element | null;
      if (isEditableElement(target)) {
        syncAfterKeyboardDismiss();
        return;
      }
      syncImmediately();
    };

    const onChatForceKeyboardSync = () => {
      if (window.innerWidth >= 871) return;
      syncAfterKeyboardDismiss();
    };

    syncImmediately();
    viewport?.addEventListener("resize", syncImmediately);
    viewport?.addEventListener("scroll", syncLight);
    window.addEventListener("resize", syncImmediately);
    window.addEventListener("orientationchange", syncImmediately);
    window.addEventListener("focus", syncImmediately);
    window.addEventListener("pageshow", syncImmediately);
    document.addEventListener("visibilitychange", syncLight);
    document.addEventListener("focusin", syncImmediately);
    document.addEventListener("focusout", onFocusOut);
    window.addEventListener("chat-force-keyboard-dismiss-sync", onChatForceKeyboardSync as EventListener);

    return () => {
      viewport?.removeEventListener("resize", syncImmediately);
      viewport?.removeEventListener("scroll", syncLight);
      window.removeEventListener("resize", syncImmediately);
      window.removeEventListener("orientationchange", syncImmediately);
      window.removeEventListener("focus", syncImmediately);
      window.removeEventListener("pageshow", syncImmediately);
      document.removeEventListener("visibilitychange", syncLight);
      document.removeEventListener("focusin", syncImmediately);
      document.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("chat-force-keyboard-dismiss-sync", onChatForceKeyboardSync as EventListener);
      if (rafID !== null) window.cancelAnimationFrame(rafID);
      if (burstRafID !== null) window.cancelAnimationFrame(burstRafID);
      clearDismissTimers();
    };
  }, [isFullscreenMobilePage]);

  const chatViewportStyle: CSSProperties | undefined =
    isFullscreenMobilePage && chatViewportHeight
      ? ({ "--chat-mobile-vh": `${chatViewportHeight}px` } as CSSProperties)
      : undefined;
  const pageContainerClass = isGiftViewPage
    ? "h-[100dvh] overflow-hidden p-0 m-0"
    : isRoomCallPage
      ? "h-[var(--chat-mobile-vh,100dvh)] overflow-hidden pb-0"
      : isFullscreenMobilePage
        ? "h-[var(--chat-mobile-vh,100dvh)] overflow-hidden pb-0 min-[871px]:h-auto min-[871px]:overflow-visible min-[871px]:pb-6"
        : "pb-[calc(5rem+env(safe-area-inset-bottom))] min-[871px]:pb-6";

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
    if (!token) {
      setUnreadCount(0);
      return;
    }
    let cancelled = false;
    const refreshUnread = async () => {
      try {
        const res = await api.notificationsUnread(token);
        if (!cancelled) setUnreadCount(res.unread_count || 0);
      } catch {
        // тихо игнорируем, чтобы не мешать остальному UI
      }
    };

    void refreshUnread();
    const pollID = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshUnread();
    }, 15000);
    const onFocus = () => {
      void refreshUnread();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(pollID);
      window.removeEventListener("focus", onFocus);
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
    { label: t("nav.feed"), path: "/" , icon: "feed"},
    { label: t("nav.search"), path: "/search", icon: "search"},
    { label: t("nav.chats"), path: "/chats", icon: "messages"},
    { label: t("nav.rooms"), path: "/rooms", icon: "radio"},
    { label: t("nav.notifications"), path: "/notifications", icon: "bell"},
    { label: t("nav.telegram"), path: telegramChannelUrl, icon: "telegram" },
    { label: t("nav.profile"), path: "/profile", icon: "user"},
    isAuthed
      ? { label: t("nav.logout"), path: "/logout", icon: "exit" }
      : { label: t("nav.login"), path: "/login", icon: "login" },
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
      {!isGiftViewPage ? (
        <div className="fixed right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-[140]">
          <LanguageSwitcher />
        </div>
      ) : null}
      {!isAuthPage && !isGiftPage && (
        <Navigation
          items={items}
          onClick={handleTabClick}
          activePath={location.pathname}
          hideMobileBottomBar={isFullscreenMobilePage}
        />
      )}
      <AuthGateModal />
      <div className={isGiftViewPage ? "w-full max-w-none px-0" : "mx-auto max-w-6xl px-3 md:px-8"}>
        <div
          key={location.pathname}
          style={chatViewportStyle}
          className={pageContainerClass}
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
                    title={t("auth.required_title")}
                    message={t("auth.search_message")}
                    ctaLabel={t("auth.cta_login")}
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
                  title={t("auth.required_title")}
                  message={t("auth.notifications_message")}
                  ctaLabel={t("auth.cta_login")}
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
                    title={t("auth.required_title")}
                    message={t("auth.chats_message")}
                    ctaLabel={t("auth.cta_login")}
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
                    title={t("auth.required_title")}
                    message={t("auth.chats_message")}
                    ctaLabel={t("auth.cta_login")}
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <NotificationsSkeleton />
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/rooms"
              element={
                isAuthed ? (
                  <RoomsPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title={t("auth.required_title")}
                    message={t("auth.chats_message")}
                    ctaLabel={t("auth.cta_login")}
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <NotificationsSkeleton />
                  </AuthGateOverlay>
                )
              }
            />
            <Route
              path="/rooms/:roomId"
              element={
                isAuthed ? (
                  <RoomCallPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title={t("auth.required_title")}
                    message={t("auth.chats_message")}
                    ctaLabel={t("auth.cta_login")}
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
                    title={t("auth.required_title")}
                    message={t("auth.profile_message")}
                    ctaLabel={t("auth.cta_login")}
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
                    title={t("auth.required_title")}
                    message={t("auth.user_profile_message")}
                    ctaLabel={t("auth.cta_login")}
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
                    title={t("auth.required_title")}
                    message={t("auth.permalink_message")}
                    ctaLabel={t("auth.cta_login")}
                    className="min-h-[calc(100vh-9rem)]"
                  >
                    <PostPermalinkSkeleton />
                  </AuthGateOverlay>
                )
              }
            />
            <Route path="/gift/create" element={<GiftCreatePage />} />
            <Route path="/gift/:code" element={<GiftViewPage />} />
            <Route path="/:code" element={<GiftViewPage />} />
            <Route
              path="/admin"
              element={
                isAuthed ? (
                  <AdminPage />
                ) : (
                  <AuthGateOverlay
                    mode="page"
                    title={t("auth.required_title")}
                    message={t("auth.admin_message")}
                    ctaLabel={t("auth.cta_login")}
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
                    title={t("auth.required_title")}
                    message={t("auth.moderation_message")}
                    ctaLabel={t("auth.cta_login")}
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
                    title={t("auth.required_title")}
                    message={t("auth.reports_message")}
                    ctaLabel={t("auth.cta_login")}
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
                    title={t("auth.required_title")}
                    message={t("auth.logs_message")}
                    ctaLabel={t("auth.cta_login")}
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

import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import FeedPage from "./Feed";
import LoginPage from "./Login";
import RegisterPage from "./Register";
import Placeholder from "./Placeholder";
import ProfilePage from "./Profile";
import ProfileUserPage from "./ProfileUser";
import SearchPage from "./Search";
import NotificationsPage from "./Notifications";
import PostPermalinkPage from "./PostPermalink";
import AdminPage from "./Admin";
import ModerationPage from "./Moderation";
import ModerationReportsPage from "./ModerationReports";
import { useAuthStore } from "../store/auth";
import Navigation from "../ui/Navigation";
import { useNotificationStore } from "../store/notifications";
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
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthed = !!token && !isJwtExpired(token);
  const telegramChannelUrl = "https://t.me/+DGppZq0WZipkNDEy";

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

  const items = [
    { label: "Лента", path: "/" , icon: "feed"},
    { label: "Поиск", path: "/search", icon: "search"},
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
        <Navigation items={items} onClick={handleTabClick} activePath={location.pathname} />
      )}
      <AuthGateModal />
      <div className="mx-auto max-w-6xl px-3 md:px-8">
        <div
          key={location.pathname}
          className="pb-[calc(5rem+env(safe-area-inset-bottom))] min-[871px]:pb-6"
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

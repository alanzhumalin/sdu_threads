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

function Protected({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.token);
  const isAuthed = !!token && !isJwtExpired(token);
  if (!isAuthed) {
    return <Navigate to="/login" replace />;
  }
  return children;
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
      if (location.pathname !== "/login" && location.pathname !== "/register") {
        navigate("/login", { replace: true });
      }
    }
  }, [token, isAuthed, setToken, navigate, location.pathname]);

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
    !isAuthed && { label: "Регистрация", path: "/register", icon: "user-plus" },
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
      <div className="mx-auto max-w-6xl px-3 md:px-8">
        <div
          key={location.pathname}
          className="pb-[calc(5rem+env(safe-area-inset-bottom))] min-[871px]:pb-6"
        >
          <Routes location={location}>
            <Route
              path="/"
              element={
                <Protected>
                  <FeedPage />
                </Protected>
              }
            />
            <Route
              path="/search"
              element={
                <Protected>
                  <SearchPage />
                </Protected>
              }
            />
          <Route
            path="/notifications"
            element={
              <Protected>
                <NotificationsPage />
              </Protected>
            }
          />
            <Route
              path="/profile"
              element={
                <Protected>
                  <ProfilePage />
                </Protected>
              }
            />
            <Route
              path="/u/:username"
              element={
                <Protected>
                  <ProfileUserPage />
                </Protected>
              }
            />
            <Route
              path="/p/:id"
              element={
                <Protected>
                  <PostPermalinkPage />
                </Protected>
              }
            />
            <Route
              path="/admin"
              element={
                <Protected>
                  <AdminPage />
                </Protected>
              }
            />
            <Route
              path="/moderation"
              element={
                <Protected>
                  <ModerationPage />
                </Protected>
              }
            />
            <Route
              path="/moderation/reports"
              element={
                <Protected>
                  <ModerationReportsPage />
                </Protected>
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

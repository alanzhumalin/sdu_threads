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
import { useAuthStore } from "../store/auth";
import Navigation from "../ui/Navigation";

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
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthed = !!token && !isJwtExpired(token);

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

  const items = [
    { label: "Лента", path: "/" , icon: "feed"},
    { label: "Поиск", path: "/search", icon: "search"},
    { label: "Уведомления", path: "/notifications", icon: "bell"},
    { label: "Профиль", path: "/profile", icon: "user"},
    isAuthed
      ? { label: "Выйти", path: "/logout", icon: "exit" }
      : { label: "Вход", path: "/login", icon: "login" },
    !isAuthed && { label: "Регистрация", path: "/register", icon: "user-plus" },
  ].filter(Boolean) as { label: string; path: string; icon: string }[];

  const handleTabClick = (path: string) => {
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
      <div className="mx-auto max-w-6xl px-3 md:px-8 md:h-screen md:overflow-hidden">
        <div key={location.pathname} className="pb-20 md:pb-6 md:overflow-y-auto md:h-screen">
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

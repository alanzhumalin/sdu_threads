import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import FeedPage from "./Feed";
import LoginPage from "./Login";
import RegisterPage from "./Register";
import Placeholder from "./Placeholder";
import ProfilePage from "./Profile";
import ProfileUserPage from "./ProfileUser";
import SearchPage from "./Search";
import NotificationsPage from "./Notifications";
import { useAuthStore } from "../store/auth";
import Navigation from "../ui/Navigation";

function Protected({ children }: { children: JSX.Element }) {
  const token = useAuthStore((s) => s.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();
  const location = useLocation();

  const items = [
    { label: "Лента", path: "/" , icon: "feed"},
    { label: "Поиск", path: "/search", icon: "search"},
    { label: "Уведомления", path: "/notifications", icon: "bell"},
    { label: "Профиль", path: "/profile", icon: "user"},
    token
      ? { label: "Выйти", path: "/logout", icon: "exit" }
      : { label: "Вход", path: "/login", icon: "login" },
    !token && { label: "Регистрация", path: "/register", icon: "user-plus" },
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
        <div className="pb-20 md:pb-6 md:overflow-y-auto md:h-screen">
          <Routes>
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
              path="/u/:username"
              element={
                <Protected>
                  <ProfileUserPage />
                </Protected>
              }
            />
            <Route
              path="/login"
              element={token ? <Navigate to="/" replace /> : <LoginPage />}
            />
            <Route
              path="/register"
              element={token ? <Navigate to="/" replace /> : <RegisterPage />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

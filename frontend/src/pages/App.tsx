import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import FeedPage from "./Feed";
import LoginPage from "./Login";
import RegisterPage from "./Register";
import Placeholder from "./Placeholder";
import ProfilePage from "./Profile";
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
    <div className="min-h-screen bg-black text-white flex">
      {!isAuthPage && (
        <Navigation items={items} onClick={handleTabClick} activePath={location.pathname} />
      )}
      <div className="flex-1 pb-20 md:pb-0">
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
                <Placeholder title="Поиск" />
              </Protected>
            }
          />
          <Route
            path="/notifications"
            element={
              <Protected>
                <Placeholder title="Уведомления" />
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
  );
}

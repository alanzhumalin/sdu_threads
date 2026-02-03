import {
  Bell,
  Home,
  LogIn,
  LogOut,
  Plus,
  Search,
  User,
  UserPlus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNotificationStore } from "../store/notifications";

type NavItem = { label: string; path: string; icon: string };

type Props = {
  items: NavItem[];
  activePath?: string;
  onClick: (path: string) => void;
};

const icons: Record<string, JSX.Element> = {
  feed: <Home size={22} strokeWidth={1.7} />,
  search: <Search size={22} strokeWidth={1.7} />,
  bell: <Bell size={22} strokeWidth={1.7} />,
  user: <User size={22} strokeWidth={1.7} />,
  login: <LogIn size={22} strokeWidth={1.7} />,
  "user-plus": <UserPlus size={22} strokeWidth={1.7} />,
  exit: <LogOut size={22} strokeWidth={1.7} />,
  plus: <Plus size={22} strokeWidth={1.7} />,
  bell2: <Bell size={22} strokeWidth={1.7} />,
};

export default function Navigation({ items, onClick, activePath }: Props) {
  const navRef = useRef<HTMLDivElement | null>(null);
  const [left, setLeft] = useState<number>(24);
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  useEffect(() => {
    const updatePosition = () => {
      const feed = document.querySelector<HTMLElement>("[data-feed-root]");
      const navEl = navRef.current;
      if (!feed || !navEl) return;
      const feedRect = feed.getBoundingClientRect();
      const navWidth = navEl.offsetWidth;
      const nextLeft = feedRect.left - navWidth - 20; // 20px gap слева от ленты
      setLeft(Math.max(16, nextLeft)); // не прижимаем к самому краю
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, []);

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        ref={navRef}
        style={{ left }}
        className="hidden md:flex fixed top-32 z-30 flex-col items-center space-y-2.5 p-2 rounded-2xl border border-white/10 bg-black/80 backdrop-blur"
      >
        {items.map((item) => (
          <button
            key={item.path}
            onClick={() => onClick(item.path)}
            className={`nav-icon ${
              item.icon === "exit"
                ? "danger"
                : activePath === item.path
                  ? "active"
                  : "sidebar-pill hover:border-white/30 hover:bg-white/10"
            }`}
            title={item.label}
          >
            <span
              className={
                item.icon === "exit"
                  ? "text-red-400"
                  : activePath === item.path
                    ? "text-black"
                    : "text-white/60"
              }
            >
              <span className="relative grid place-items-center w-6 h-6">
                {icons[item.icon] || null}
                {item.icon === "bell" && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-400 rounded-full border border-black" />
                )}
              </span>
            </span>
          </button>
        ))}
      </nav>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/90 backdrop-blur px-4 py-2 flex justify-around">
        {items.map((item) => (
          <button
            key={item.path}
            onClick={() => onClick(item.path)}
            className={`flex flex-col items-center text-xs transition ${
              item.icon === "exit"
                ? "text-red-400"
                : activePath === item.path
                  ? "text-black bg-white rounded-full px-3 py-2"
                  : "text-white/60"
            }`}
          >
            <span className="mb-1 relative grid place-items-center w-6 h-6">
              {icons[item.icon] || null}
              {item.icon === "bell" && unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-400 rounded-full border border-black" />
              )}
            </span>
          </button>
        ))}
      </nav>
    </>
  );
}

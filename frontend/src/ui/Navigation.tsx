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
import { useRef } from "react";
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
  const unreadCount = useNotificationStore((s) => s.unreadCount);

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        ref={navRef}
        style={{ left: "max(16px, calc(50% - 336px - 80px))" }}
        className="hidden min-[871px]:flex fixed top-32 z-30 flex-col items-center space-y-2.5 p-2 rounded-2xl border border-white/10 bg-black/80 backdrop-blur"
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
      <nav
        className="min-[871px]:hidden fixed bottom-0 left-0 right-0 z-[120] border-t border-white/10 bg-black/90 backdrop-blur px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] flex justify-around"
      >
        {items.map((item) => (
          <button
            key={item.path}
            onClick={() => onClick(item.path)}
            className={`grid place-items-center w-12 h-12 rounded-full transition ${
              item.icon === "exit"
                ? "text-red-400 hover:bg-white/5"
                : activePath === item.path
                  ? "text-black bg-white"
                  : "text-white/60 hover:text-white hover:bg-white/5"
            }`}
            title={item.label}
          >
            <span className="relative grid place-items-center w-6 h-6">
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

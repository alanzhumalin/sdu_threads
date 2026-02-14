import {
  Bell,
  Home,
  LogIn,
  LogOut,
  MessagesSquare,
  Plus,
  Search,
  User,
} from "lucide-react";
import { useRef } from "react";
import { useNotificationStore } from "../store/notifications";
import { useChatStore } from "../store/chats";
import telegramIconUrl from "../assets/telegram.png";

type NavItem = { label: string; path: string; icon: string };

type Props = {
  items: NavItem[];
  activePath?: string;
  onClick: (path: string) => void;
  hideMobileBottomBar?: boolean;
};

const icons: Record<string, JSX.Element> = {
  feed: <Home size={22} strokeWidth={1.7} />,
  search: <Search size={22} strokeWidth={1.7} />,
  bell: <Bell size={22} strokeWidth={1.7} />,
  messages: <MessagesSquare size={22} strokeWidth={1.7} />,
  telegram: (
    <img
      src={telegramIconUrl}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="w-full h-full object-cover block"
    />
  ),
  user: <User size={22} strokeWidth={1.7} />,
  login: <LogIn size={22} strokeWidth={1.7} />,
  exit: <LogOut size={22} strokeWidth={1.7} />,
  plus: <Plus size={22} strokeWidth={1.7} />,
  bell2: <Bell size={22} strokeWidth={1.7} />,
};

export default function Navigation({ items, onClick, activePath, hideMobileBottomBar = false }: Props) {
  const navRef = useRef<HTMLDivElement | null>(null);
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  const chatsUnreadCount = useChatStore((s) => s.unreadCount);
  const mobileItems = items.filter((i) => i.icon !== "telegram" && i.icon !== "exit");
  const isActive = (path: string) =>
    !!activePath && (activePath === path || (path !== "/" && activePath.startsWith(`${path}/`)));

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
                : isActive(item.path)
                  ? "active"
                  : item.icon === "telegram"
                    ? "sidebar-pill hover:border-white/30"
                    : "sidebar-pill hover:border-white/30 hover:bg-white/10"
            }`}
            title={item.label}
          >
            <span
              className={
                item.icon === "exit"
                  ? "text-red-400"
                  : isActive(item.path)
                    ? "text-black"
                    : "text-white/60"
              }
            >
              <span className="relative grid place-items-center w-6 h-6">
                {icons[item.icon] || null}
                {item.icon === "bell" && unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-400 rounded-full border border-black" />
                )}
                {item.icon === "messages" && chatsUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-400 rounded-full border border-black" />
                )}
              </span>
            </span>
          </button>
        ))}
      </nav>

      {/* Mobile bottom bar */}
      {!hideMobileBottomBar && (
        <nav
          className="min-[871px]:hidden fixed bottom-0 left-0 right-0 z-[120] border-t border-white/10 bg-black/90 backdrop-blur px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] flex justify-around"
        >
          {mobileItems.map((item) => (
            <button
              key={item.path}
              onClick={() => onClick(item.path)}
              className={`grid place-items-center w-12 h-12 rounded-full transition ${
                item.icon === "exit"
                  ? "text-red-400 hover:bg-white/5"
                  : isActive(item.path)
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
                {item.icon === "messages" && chatsUnreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-sky-400 rounded-full border border-black" />
                )}
              </span>
            </button>
          ))}
        </nav>
      )}
    </>
  );
}

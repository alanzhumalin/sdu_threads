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
  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex flex-col w-20 p-5 space-y-4">
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
              {icons[item.icon] || null}
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
            <span className="mb-1">{icons[item.icon] || null}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

type NavItem = { label: string; path: string; icon: string };

type Props = {
  items: NavItem[];
  activePath?: string;
  onClick: (path: string) => void;
};

const icons: Record<string, JSX.Element> = {
  feed: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 5.5h15M4.5 10h15M4.5 14.5h10M4.5 19h6" />
    </svg>
  ),
  search: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m15 15 3 3" />
    </svg>
  ),
  bell: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a2 2 0 0 1-2-2h4a2 2 0 0 1-2 2Zm-7-5 1.4-1.4A2 2 0 0 0 7 13.2V11a5 5 0 0 1 10 0v2.2a2 2 0 0 0 .6 1.4L19 16H5Z" />
    </svg>
  ),
  user: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 19c1.5-2.5 3.5-3.75 6-3.75S16.5 16.5 18 19" />
    </svg>
  ),
  login: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14m0 0h7m-7 0H5" />
    </svg>
  ),
  "user-plus": (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 19c1.5-2.5 3.5-3.75 6-3.75S15.5 16.5 17 19M18 8v3m-1.5-1.5H21" />
    </svg>
  ),
  exit: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12H3m0 0 3.75 3.75M3 12l3.75-3.75M9 5.25V3h9v18h-9v-2.25" />
    </svg>
  ),
  plus: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
    </svg>
  ),
  bell2: (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a2 2 0 0 1-2-2h4a2 2 0 0 1-2 2Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.5 16 7.7 14.8A2 2 0 0 0 8.3 13.4V11a4 4 0 1 1 8 0v2.4a2 2 0 0 0 .6 1.4l1.2 1.2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m19 11-.8.8a1.2 1.2 0 0 0 0 1.7l.8.8" />
    </svg>
  ),
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
            className={`nav-icon sidebar-pill ${
              item.icon === "exit"
                ? "danger"
                : activePath === item.path
                  ? "active border-white/40"
                  : "hover:border-white/30 hover:bg-white/10"
            }`}
            title={item.label}
          >
            <span
              className={
                item.icon === "exit"
                  ? "text-red-400"
                  : activePath === item.path
                    ? "text-white"
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
                  ? "text-white"
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

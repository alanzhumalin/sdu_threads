import { useEffect, useRef, useState } from "react";
import { Hash, Loader2, Search, User as UserIcon } from "lucide-react";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";

type UserResult = {
  id: string;
  username: string;
  full_name?: string;
  major?: string;
  avatar_url?: string;
};

type TagResult = {
  id: string;
  name: string;
  post_count?: number;
};

export default function SearchPage() {
  const token = useAuthStore((s) => s.token);
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserResult[]>([]);
  const [hashtags, setHashtags] = useState<TagResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [popular, setPopular] = useState<TagResult[]>([]);
  const [popularLoading, setPopularLoading] = useState(false);
  const [popularError, setPopularError] = useState("");

  const activeQueryRef = useRef("");

  useEffect(() => {
    const loadPopular = async () => {
      setPopularLoading(true);
      try {
        const res = await api.popularHashtags(10);
        setPopular(res);
        setPopularError("");
      } catch (e: any) {
        setPopularError(e.message || "Не удалось загрузить популярные теги");
      } finally {
        setPopularLoading(false);
      }
    };
    loadPopular();
  }, []);

  const performSearch = async (term: string) => {
    const currentMark = term;
    activeQueryRef.current = currentMark;
    setLoading(true);
    try {
      const [u, h] = await Promise.all([
        api.searchUsers(term, 15, 0, token),
        api.searchHashtags(term, 15),
      ]);
      if (activeQueryRef.current !== currentMark) return;
      setUsers(u);
      setHashtags(h);
      setError("");
    } catch (e: any) {
      if (activeQueryRef.current !== currentMark) return;
      setError(e.message || "Не удалось выполнить поиск");
      setUsers([]);
      setHashtags([]);
    } finally {
      if (activeQueryRef.current === currentMark) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      activeQueryRef.current = "";
      setUsers([]);
      setHashtags([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      performSearch(trimmed);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, token]);

  const showPopular = query.trim() === "";
  return (
    <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-white/60">Поиск</p>
          <h1 className="text-2xl font-semibold text-white">Найдите людей или хэштеги</h1>
        </div>
      </div>

      <div className="card p-4 flex items-center gap-3">
        <Search className="w-5 h-5 text-white/60" strokeWidth={1.7} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Имя, ник или #тег"
          className="w-full bg-transparent outline-none text-white placeholder:text-white/40"
        />
      </div>

      {showPopular && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Популярные хэштеги</h2>
            {popularLoading && (
              <span className="text-white/50 text-sm flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Загрузка...
              </span>
            )}
          </div>
          {popularError && <p className="text-red-400 text-sm">{popularError}</p>}
          {!popularLoading && popular.length === 0 && !popularError && (
            <div className="card p-4 text-white/60 text-sm">Пока нет популярных хэштегов.</div>
          )}
          <div className="space-y-2">
            {popular.map((tag) => (
              <div
                key={tag.id}
                className="card p-3 flex items-center justify-between hover:border-white/25 transition"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                    <Hash className="w-5 h-5 text-white" strokeWidth={1.7} />
                  </div>
                  <div>
                    <p className="text-white font-semibold">#{tag.name}</p>
                    <p className="text-white/50 text-sm">
                      {tag.post_count ? `${tag.post_count} постов` : "Постов пока нет"}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {!showPopular && (
        <section className="space-y-4">
          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="space-y-2">
            <h3 className="text-sm uppercase tracking-wide text-white/50">Пользователи</h3>
            {loading && (
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="card p-3 flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-white/10" />
                    <div className="space-y-2 w-full">
                      <div className="h-3 bg-white/10 rounded-full w-1/3" />
                      <div className="h-2 bg-white/5 rounded-full w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            )}
            {!loading && users.length === 0 && (
              <div className="card p-6 text-white/60 text-sm text-center">Нет пользователей по запросу</div>
            )}
            {!loading &&
              users.map((user) => (
                <div
                  key={user.id}
                  className="card p-3 flex items-center justify-between hover:border-white/25 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
                      {user.full_name?.[0]?.toUpperCase() ||
                        user.username?.[0]?.toUpperCase() ||
                        "U"}
                    </div>
                    <div>
                      <p className="text-white font-semibold">{user.full_name || "Без имени"}</p>
                      <p className="text-white/50 text-sm">@{user.username}</p>
                      {user.major && <p className="text-white/50 text-xs mt-1">{user.major}</p>}
                    </div>
                  </div>
                  <UserIcon className="w-4 h-4 text-white/40" strokeWidth={1.6} />
                </div>
              ))}
          </div>

          <div className="space-y-2">
            <h3 className="text-sm uppercase tracking-wide text-white/50">Хэштеги</h3>
            {loading && (
              <div className="space-y-2">
                {[1, 2, 3].map((n) => (
                  <div key={n} className="card p-3 flex items-center gap-3 animate-pulse">
                    <div className="w-10 h-10 rounded-full bg-white/10" />
                    <div className="h-3 bg-white/10 rounded-full w-1/4" />
                  </div>
                ))}
              </div>
            )}
            {!loading && hashtags.length === 0 && (
              <div className="card p-6 text-white/60 text-sm text-center">Нет хэштегов по запросу</div>
            )}
            {!loading &&
              hashtags.map((tag) => (
                <div
                  key={tag.id}
                  className="card p-3 flex items-center justify-between hover:border-white/25 transition"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
                      <Hash className="w-5 h-5 text-white" strokeWidth={1.7} />
                    </div>
                    <div>
                      <p className="text-white font-semibold">#{tag.name}</p>
                    </div>
                  </div>
                </div>
              ))}
          </div>

        </section>
      )}
    </main>
  );
}

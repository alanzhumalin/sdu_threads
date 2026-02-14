import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Crown } from "lucide-react";
import { api } from "../api/client";
import { ErrorMessage } from "./ErrorMessage";
import { MentionPreview } from "./MentionPreview";
import { VerifiedBadge } from "./VerifiedBadge";

type TopUser = {
  id: string;
  username: string;
  full_name: string;
  is_verified?: boolean;
  avatar_url?: string;
  followers: number;
};

export function TopUsers() {
  const [users, setUsers] = useState<TopUser[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setLoading(true);
    api
      .topUsers(3)
      .then((res) => {
        setUsers(res);
        setError("");
      })
      .catch((e) => setError(e?.message || "Не удалось загрузить топ пользователей"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <aside
      className="hidden min-[1285px]:block fixed w-64 z-10 space-y-3"
      style={{ left: "calc(50% + 368px)", top: "8rem" }}
    >
      <div className="card p-4 space-y-3">
        <p className="text-white font-semibold text-sm">Топ пользователей</p>

        <div className="space-y-3">
          {loading && (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <div className="h-3 bg-white/10 rounded-full w-2/3" />
                    <div className="h-2 bg-white/5 rounded-full w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && <ErrorMessage message={error} />}

          {!loading && !error && users.length === 0 && (
            <p className="text-white/60 text-sm">Нет данных</p>
          )}

          {!loading &&
            !error &&
            users.map((u, idx) => (
              <div key={u.id} className="flex items-center gap-3">
                <Link to={`/u/${u.username}`} className="relative w-10 h-10 shrink-0">
                  <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold overflow-hidden">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      (u.full_name?.[0] || u.username?.[0] || "U").toUpperCase()
                    )}
                  </div>
                  {idx === 0 && (
                    <span className="absolute -top-2 -left-2 z-10 w-6 h-6 rounded-full bg-black/80 border border-white/10 grid place-items-center pointer-events-none">
                      <Crown className="w-3.5 h-3.5 text-amber-300" strokeWidth={2} />
                    </span>
                  )}
                </Link>

                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">
                    <MentionPreview username={u.username} className="">
                      <Link to={`/u/${u.username}`} className="hover:underline">
                        <span className="inline-flex items-center gap-[3px]">
                          <span>{u.full_name || "Без имени"}</span>
                          {u.is_verified ? <VerifiedBadge /> : null}
                        </span>
                      </Link>
                    </MentionPreview>
                  </p>
                  <p className="text-white/60 text-xs truncate">@{u.username}</p>
                  <p className="text-white/50 text-xs">{u.followers} подписчиков</p>
                </div>
              </div>
            ))}
        </div>
      </div>
    </aside>
  );
}

import { useEffect, useState } from "react";
import { api } from "../api/client";

type TopUser = {
  id: string;
  username: string;
  full_name: string;
  avatar_url?: string;
  followers: number;
};

export function TopUsers() {
  const [users, setUsers] = useState<TopUser[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    api
      .topUsers(3)
      .then((res) => {
        setUsers(res);
        setError("");
      })
      .catch((e) => setError(e?.message || "Не удалось загрузить топ пользователей"));
  }, []);

  if (error) return null;

  return (
    <aside
      className="hidden lg:block fixed w-64 z-10 space-y-3"
      style={{ left: "calc(50% + 368px)", top: "8rem" }}
    >
      <div className="card p-4 space-y-3">
        <p className="text-white font-semibold text-sm">Топ пользователей</p>

        <div className="space-y-3">
          {users.length === 0 && <p className="text-white/60 text-sm">Нет данных</p>}

          {users.map((u) => (
            <div key={u.id} className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold overflow-hidden">
                {u.avatar_url ? (
                  <img src={u.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  (u.full_name?.[0] || u.username?.[0] || "U").toUpperCase()
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold truncate">{u.full_name || "Без имени"}</p>
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

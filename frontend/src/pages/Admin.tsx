import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { UserRow } from "../components/UserRow";
import { AvatarCircle } from "../components/Avatar";
import { VerifiedBadge } from "../components/VerifiedBadge";
import type { MediaItem } from "../types/media";

type AdminStats = {
  users_count: number;
  posts_count: number;
  active_users_15m: number;
  generated_at?: string;
};

type AdminUser = {
  id: string;
  username: string;
  full_name: string;
  is_verified?: boolean;
  avatar_url?: string;
  role: string;
  created_at: string;
};

type AdminPost = {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  is_verified?: boolean;
  avatar_url?: string;
  content: string;
  media?: MediaItem[];
  created_at: string;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
};

export default function AdminPage() {
  const token = useAuthStore((s) => s.token);
  const navigate = useNavigate();

  const [myRole, setMyRole] = useState<string | null>(null);
  const isAdmin = myRole === "admin";

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);

  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("");
  const [roleSaving, setRoleSaving] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [selectedVerified, setSelectedVerified] = useState(false);
  const [verifiedSaving, setVerifiedSaving] = useState(false);
  const [verifiedError, setVerifiedError] = useState<string | null>(null);

  const [postsQuery, setPostsQuery] = useState<string>("");
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [postsNextOffset, setPostsNextOffset] = useState<number | null>(0);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);

  const canLoadMorePosts = useMemo(() => typeof postsNextOffset === "number", [postsNextOffset]);

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    setStatsLoading(true);
    setStatsError(null);
    setMyRole(null);
    api
      .adminMe(token)
      .then((me) => {
        if (cancelled) return;
        setMyRole(String(me?.role || "").trim().toLowerCase() || null);
      })
      .catch((e: any) => {
        if (cancelled) return;
        if (e?.code === "FORBIDDEN") {
          navigate("/", { replace: true });
          return;
        }
        // If we can't load role, keep UI conservative (hide role-changing controls).
        setMyRole(null);
      });
    api
      .adminStats(token)
      .then((s) => {
        if (cancelled) return;
        setStats(s);
      })
      .catch((e: any) => {
        if (cancelled) return;
        if (e?.code === "FORBIDDEN") {
          navigate("/", { replace: true });
          return;
        }
        setStatsError(e?.message || "Не удалось загрузить статистику");
      })
      .finally(() => {
        if (!cancelled) setStatsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  const runUserSearch = async () => {
    if (!token) return;
    setUsersLoading(true);
    setUsersError(null);
    try {
      const res = await api.adminUsers(query, 30, 0, token);
      setUsers(res.items as AdminUser[]);
    } catch (e: any) {
      if (e?.code === "FORBIDDEN") {
        navigate("/", { replace: true });
        return;
      }
      setUsersError(e?.message || "Не удалось загрузить пользователей");
    } finally {
      setUsersLoading(false);
    }
  };

  const deleteUser = async (u: AdminUser) => {
    if (!token) return;
    if (deletingUserId) return;
    const ok = window.confirm(
      `Удалить пользователя @${u.username}?\n\nЭто удалит его профиль, посты, комментарии, лайки и подписки.`
    );
    if (!ok) return;
    setDeletingUserId(u.id);
    setUsersError(null);
    try {
      await api.adminDeleteUser(u.id, token);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      setSelected((prev) => (prev?.id === u.id ? null : prev));
    } catch (e: any) {
      setUsersError(e?.message || "Не удалось удалить пользователя");
    } finally {
      setDeletingUserId(null);
    }
  };

  const openUser = async (u: AdminUser) => {
    if (!token) return;
    setSelected(u);
    setSelectedRole(u.role || "user");
    setSelectedVerified(Boolean(u.is_verified));
    setRoleError(null);
    setVerifiedError(null);
    setPostsQuery("");
    setPosts([]);
    setPostsNextOffset(0);
    setPostsError(null);
    await loadMorePosts(u, 0, "");
  };

  const loadMorePosts = async (u: AdminUser, offset: number | null, q: string) => {
    if (!token) return;
    if (typeof offset !== "number") return;
    setPostsLoading(true);
    setPostsError(null);
    try {
      const res = await api.adminUserPosts(u.id, 20, offset, q, token);
      const items = Array.isArray(res.items) ? res.items : [];
      setPosts((prev) => (offset === 0 ? (items as AdminPost[]) : [...prev, ...(items as AdminPost[])]));
      setPostsNextOffset(typeof res.nextOffset === "number" ? res.nextOffset : null);
    } catch (e: any) {
      if (e?.code === "FORBIDDEN") {
        navigate("/", { replace: true });
        return;
      }
      setPostsError(e?.message || "Не удалось загрузить посты пользователя");
      setPostsNextOffset(null);
    } finally {
      setPostsLoading(false);
    }
  };

  const applyPostsQuery = async () => {
    if (!selected) return;
    setPosts([]);
    setPostsNextOffset(0);
    setPostsError(null);
    await loadMorePosts(selected, 0, postsQuery);
  };

  const saveRole = async () => {
    if (!token || !selected) return;
    const role = (selectedRole || "user") as "user" | "moderator" | "admin";
    setRoleSaving(true);
    setRoleError(null);
    try {
      await api.adminSetUserRole(selected.id, role, token);
      setSelected((prev) => (prev ? { ...prev, role } : prev));
      setUsers((prev) => prev.map((uu) => (uu.id === selected.id ? { ...uu, role } : uu)));
    } catch (e: any) {
      if (e?.code === "FORBIDDEN") {
        setRoleError("Только admin может менять роли.");
      } else {
        setRoleError(e?.message || "Не удалось обновить роль");
      }
    } finally {
      setRoleSaving(false);
    }
  };

  const saveVerified = async () => {
    if (!token || !selected) return;
    setVerifiedSaving(true);
    setVerifiedError(null);
    try {
      await api.adminSetUserVerified(selected.id, selectedVerified, token);
      setSelected((prev) =>
        prev ? { ...prev, is_verified: selectedVerified } : prev
      );
      setUsers((prev) =>
        prev.map((uu) =>
          uu.id === selected.id ? { ...uu, is_verified: selectedVerified } : uu
        )
      );
    } catch (e: any) {
      if (e?.code === "FORBIDDEN") {
        setVerifiedError("Только admin может выдавать верификацию.");
      } else {
        setVerifiedError(e?.message || "Не удалось обновить верификацию");
      }
    } finally {
      setVerifiedSaving(false);
    }
  };

  const removePost = async (postId: string) => {
    if (!token) return;
    const reason = window.prompt("Причина удаления (необязательно):") || "";
    try {
      await api.adminRemovePost(postId, reason || undefined, token);
      setPosts((prev) => prev.filter((p) => p?.id !== postId));
    } catch (e: any) {
      alert(e?.message || "Не удалось удалить пост");
    }
  };

  return (
    <main className="max-w-[672px] w-full mx-auto py-6 space-y-4">
      <div className="card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Admin Dashboard</h1>
            <p className="text-xs text-white/60 mt-1">
              Ваша роль: {myRole || "unknown"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => navigate("/moderation/logs")}
            >
              Логи модерации
            </button>
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
              onClick={() => runUserSearch()}
              disabled={!token || usersLoading}
            >
              Обновить
            </button>
          </div>
        </div>
        {statsLoading ? (
          <div className="mt-3 text-white/60 text-sm">Загрузка статистики...</div>
        ) : statsError ? (
          <div className="mt-3 text-red-300 text-sm">{statsError}</div>
        ) : stats ? (
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-xl border border-white/10 bg-black/60 p-3">
              <div className="text-white/60">Пользователи</div>
              <div className="text-white text-lg font-semibold">{stats.users_count}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/60 p-3">
              <div className="text-white/60">Посты</div>
              <div className="text-white text-lg font-semibold">{stats.posts_count}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/60 p-3">
              <div className="text-white/60">Активные (15м)</div>
              <div className="text-white text-lg font-semibold">{stats.active_users_15m}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по username / full name / email / id"
            className="flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white placeholder:text-white/50 focus:border-white/30 outline-none"
          />
          <button
            type="button"
            className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
            onClick={() => runUserSearch()}
            disabled={!token || usersLoading}
          >
            Найти
          </button>
        </div>
        {usersError ? <div className="text-red-300 text-sm">{usersError}</div> : null}
        {usersLoading ? (
          <div className="text-white/60 text-sm">Загрузка...</div>
        ) : users.length === 0 ? (
          <div className="text-white/60 text-sm">Пользователи не найдены</div>
        ) : (
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                role="button"
                tabIndex={0}
                className="w-full text-left cursor-pointer"
                onClick={(e) => {
                  // Don't select user when clicking links/buttons inside the row.
                  if ((e.target as HTMLElement | null)?.closest("a,button")) return;
                  openUser(u);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openUser(u);
                  }
                }}
              >
                <UserRow
                  user={{
                    id: u.id,
                    username: u.username,
                    full_name: u.full_name,
                    is_verified: u.is_verified,
                    avatar_url: u.avatar_url,
                  }}
                  right={
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-white/60 rounded-full border border-white/10 px-2 py-1">
                        {u.role}
                      </span>
                      {isAdmin ? (
                        <button
                          type="button"
                          className="danger w-9 h-9 rounded-full border border-red-500/30 text-red-300 hover:bg-red-500/10 grid place-items-center disabled:opacity-60"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteUser(u);
                          }}
                          disabled={deletingUserId === u.id}
                          aria-label={`Удалить пользователя @${u.username}`}
                          title="Удалить пользователя"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      ) : null}
                    </div>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {selected ? (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-white font-semibold truncate">
                <span className="inline-flex items-center gap-[3px]">
                  <span>{selected.full_name}</span>
                  {selected.is_verified ? <VerifiedBadge /> : null}
                </span>{" "}
                <span className="text-white/60 text-sm">@{selected.username}</span>
              </div>
              <div className="text-white/60 text-xs truncate">{selected.id}</div>
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {isAdmin ? (
                <>
                  <select
                    className="rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white text-sm focus:border-white/30 outline-none"
                    value={selectedRole}
                    onChange={(e) => setSelectedRole(e.target.value)}
                  >
                    <option value="user">user</option>
                    <option value="moderator">moderator</option>
                    <option value="admin">admin</option>
                  </select>
                  <button
                    type="button"
                    className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                    onClick={saveRole}
                    disabled={roleSaving || selectedRole === (selected.role || "user")}
                  >
                    Сохранить
                  </button>
                  <label className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white text-sm">
                    <input
                      type="checkbox"
                      checked={selectedVerified}
                      onChange={(e) => setSelectedVerified(e.target.checked)}
                      className="accent-sky-500"
                    />
                    Галочка
                  </label>
                  <button
                    type="button"
                    className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                    onClick={saveVerified}
                    disabled={verifiedSaving || selectedVerified === Boolean(selected.is_verified)}
                  >
                    {verifiedSaving ? "Сохраняем..." : "Применить"}
                  </button>
                </>
              ) : (
                <>
                  <span className="text-xs text-white/60 rounded-full border border-white/10 px-2 py-1">
                    {selected.role}
                  </span>
                  <span className="text-xs text-amber-200/80 rounded-full border border-amber-300/30 px-2 py-1">
                    Галочку выдает только admin
                  </span>
                </>
              )}
            </div>
          </div>
          {isAdmin && roleError ? <div className="text-red-300 text-sm">{roleError}</div> : null}
          {isAdmin && verifiedError ? <div className="text-red-300 text-sm">{verifiedError}</div> : null}

          <div className="flex items-center justify-between">
            <div className="text-white/80 text-sm">Посты пользователя</div>
            {canLoadMorePosts ? (
              <button
                type="button"
                className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
                onClick={() => loadMorePosts(selected, postsNextOffset, postsQuery)}
                disabled={postsLoading}
              >
                Загрузить еще
              </button>
            ) : null}
          </div>

          <div className="flex gap-2">
            <input
              value={postsQuery}
              onChange={(e) => setPostsQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyPostsQuery();
                }
              }}
              placeholder="Поиск по post id или тексту"
              className="flex-1 rounded-xl border border-white/15 bg-black/40 px-3 py-2 text-white placeholder:text-white/50 focus:border-white/30 outline-none"
            />
            <button
              type="button"
              className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
              onClick={applyPostsQuery}
              disabled={postsLoading}
            >
              Найти
            </button>
          </div>

          {postsError ? <div className="text-red-300 text-sm">{postsError}</div> : null}
          {postsLoading && posts.length === 0 ? (
            <div className="text-white/60 text-sm">Загрузка...</div>
          ) : posts.length === 0 ? (
            <div className="text-white/60 text-sm">Постов нет</div>
          ) : (
            <div className="space-y-2">
              {posts.map((p) => (
                <div key={p.id} className="rounded-xl border border-white/10 bg-black/60 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-3">
                      <AvatarCircle
                        src={p.avatar_url}
                        fallback={p.full_name || p.username || "U"}
                        className="w-9 h-9 flex items-center justify-center text-sm font-semibold"
                      />
                      <div className="min-w-0">
                        <div className="text-white font-semibold truncate">
                          <span className="inline-flex items-center gap-[3px]">
                            <span>{p.full_name}</span>
                            {p.is_verified ? <VerifiedBadge /> : null}
                          </span>{" "}
                          <span className="text-white/60 text-sm">@{p.username}</span>
                        </div>
                        <div className="text-white/60 text-xs truncate">
                          {p.created_at ? new Date(p.created_at).toLocaleString() : p.id}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="danger px-3 py-2 rounded-full text-sm border border-red-500/30 text-red-300 hover:bg-red-500/10 shrink-0"
                      onClick={() => removePost(p.id)}
                    >
                      Удалить
                    </button>
                  </div>

                  <div className="text-white/70 text-xs mt-2">
                    ❤ {typeof p.like_count === "number" ? p.like_count : 0} · 💬{" "}
                    {typeof p.comment_count === "number" ? p.comment_count : 0}
                  </div>

                  {Array.isArray(p.media) && p.media.length > 0 && p.media[0]?.url ? (
                    <div className="mt-3">
                      <div className="relative w-full h-40 md:h-48 rounded-2xl overflow-hidden bg-black/20">
                        <img
                          src={p.media[0]!.url}
                          alt=""
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                        />
                        {p.media.length > 1 ? (
                          <span className="absolute top-2 right-2 rounded-full bg-black/60 text-white text-xs px-2 py-1 border border-white/10">
                            +{p.media.length - 1}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ) : null}

                  <div className="text-white mt-3 whitespace-pre-wrap break-words">{p.content}</div>
                  <div className="mt-2 text-white/60 text-xs break-all">{p.id}</div>
                  <div className="mt-2 flex items-center justify-end">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(p.id);
                        } catch {
                          // no-op (clipboard may be blocked)
                        }
                      }}
                      className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10"
                    >
                      Скопировать ID
                    </button>
                  </div>
                </div>
              ))}
              {postsLoading ? <div className="text-white/60 text-sm">Загрузка...</div> : null}
            </div>
          )}
        </div>
      ) : null}
    </main>
  );
}

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Loader2, Radio, Plus, Lock, X, Users } from "lucide-react";

import { api, type LiveRoom } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AvatarCircle } from "../components/Avatar";
import { ErrorMessage } from "../components/ErrorMessage";
import { VerifiedBadge } from "../components/VerifiedBadge";
import { useI18n } from "../i18n";
import { formatTimeAgo } from "../utils/time";

const ROOMS_REFRESH_MS = 5000;

export default function RoomsPage() {
  const { t, language, pick } = useI18n();
  const tr = (kk: string, ru: string, en: string) => pick({ kk, ru, en });
  const token = useAuthStore((s) => s.token);
  const location = useLocation();
  const navigate = useNavigate();

  const [items, setItems] = useState<LiveRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createRoomTitle, setCreateRoomTitle] = useState("");
  const [createRoomPrivate, setCreateRoomPrivate] = useState(false);
  const [createRoomPassword, setCreateRoomPassword] = useState("");
  const [error, setError] = useState("");

  const loadingRef = useRef(false);

  const loadRooms = useCallback(async () => {
    if (!token || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await api.liveRooms(30, 0, token);
      setItems(Array.isArray(res.items) ? res.items : []);
      setError("");
    } catch (e: any) {
      setError(e?.message || t("rooms.load_error"));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }, [token, t]);

  useEffect(() => {
    if (!token) return;
    void loadRooms();
  }, [token, loadRooms]);

  useEffect(() => {
    const state = location.state as { roomsError?: string } | null;
    const msg = typeof state?.roomsError === "string" ? state.roomsError.trim() : "";
    if (!msg) return;
    setError(msg);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!token) return;
    const intervalID = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadRooms();
    }, ROOMS_REFRESH_MS);
    return () => window.clearInterval(intervalID);
  }, [token, loadRooms]);

  const closeCreateModal = useCallback(() => {
    if (creating) return;
    setCreateModalOpen(false);
    setCreateRoomTitle("");
    setCreateRoomPrivate(false);
    setCreateRoomPassword("");
  }, [creating]);

  useEffect(() => {
    if (!createModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeCreateModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeCreateModal, createModalOpen]);

  const openCreateModal = () => {
    if (creating) return;
    setError("");
    setCreateRoomTitle("");
    setCreateRoomPrivate(false);
    setCreateRoomPassword("");
    setCreateModalOpen(true);
  };

  const submitCreateRoom = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!token || creating) return;
    const title = createRoomTitle.trim();
    const isPrivate = createRoomPrivate;
    const password = createRoomPassword.trim();
    if (isPrivate && !password) {
      setError(t("rooms.password_required"));
      return;
    }
    if (isPrivate && password.length < 4) {
      setError(tr("Құпиясөз кемі 4 таңба болуы керек", "Пароль должен быть не короче 4 символов", "Password must be at least 4 characters"));
      return;
    }
    setCreating(true);
    setError("");
    try {
      const created = await api.createLiveRoom(
        {
          title,
          is_private: isPrivate,
          password: password || undefined,
        },
        token
      );
      setCreateModalOpen(false);
      setCreateRoomTitle("");
      setCreateRoomPrivate(false);
      setCreateRoomPassword("");
      navigate(`/rooms/${created.id}`, {
        state: isPrivate ? { roomPassword: password } : undefined,
      });
    } catch (e: any) {
      setError(e?.message || t("rooms.create_error"));
    } finally {
      setCreating(false);
    }
  };

  return (
    <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-4 page-fade">
      <div>
        <p className="text-sm text-white/60">{t("rooms.page_label")}</p>
        <h1 className="text-2xl font-semibold text-white">{t("rooms.page_title")}</h1>
      </div>

      <ErrorMessage message={error} />

      {loading && items.length === 0 ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, idx) => (
            <div key={idx} className="card p-4 animate-pulse flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-44 rounded bg-white/10" />
                <div className="h-3 w-32 rounded bg-white/5" />
              </div>
              <div className="h-6 w-10 rounded-full bg-white/5" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && items.length === 0 && !error ? (
        <div className="card p-8 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-white/70">
            <Radio className="w-6 h-6" strokeWidth={1.8} />
          </div>
          <p className="text-white font-medium">{t("rooms.empty_title")}</p>
          <p className="text-sm text-white/60">{t("rooms.empty_desc")}</p>
          <button
            type="button"
            onClick={openCreateModal}
            disabled={creating}
            className="sidebar-pill px-3 py-2 text-sm hover:bg-white/10 disabled:opacity-60"
          >
            {t("rooms.create")}
          </button>
        </div>
      ) : null}

      <div className="space-y-3">
        {items.map((room) => (
          <button
            key={room.id}
            type="button"
            onClick={() => {
              if (room.is_private) {
                const roomPassword = window.prompt(t("rooms.enter_password_prompt"), "");
                if (roomPassword === null) return;
                if (!roomPassword.trim()) {
                  setError(t("rooms.password_required"));
                  return;
                }
                navigate(`/rooms/${room.id}`, {
                  state: { roomPassword: roomPassword.trim() },
                });
                return;
              }
              navigate(`/rooms/${room.id}`);
            }}
            className="card w-full p-4 text-left hover:border-white/25 transition"
          >
            <div className="flex items-start gap-3">
              <AvatarCircle
                src={room.host.avatar_url}
                fallback={room.host.full_name || room.host.username}
                className="w-12 h-12 text-base font-semibold"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-white font-semibold truncate inline-flex items-center gap-[3px]">
                      <span>{room.title || t("rooms.default_title")}</span>
                      {room.is_private ? <Lock className="w-3.5 h-3.5 text-amber-300 shrink-0" /> : null}
                    </p>
                    <p className="text-white/60 text-sm truncate mt-0.5 inline-flex items-center gap-[3px]">
                      <span>@{room.host.username}</span>
                      {room.host.is_verified ? <VerifiedBadge /> : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs font-semibold text-white">
                      <Users className="w-3.5 h-3.5" />
                      <span>{Math.max(1, room.participant_count || 0)}</span>
                    </span>
                    <p className="mt-1 text-xs text-white/50">{formatTimeAgo(room.created_at, language)}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm text-white/70 line-clamp-1 break-words">
                  {room.is_private ? t("rooms.join_hint_private") : t("rooms.join_hint")}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>

      {createModalOpen ? (
        <div
          className="fixed inset-0 z-[180] w-screen h-screen flex items-center justify-center bg-black/70 backdrop-blur-lg px-3"
          onClick={closeCreateModal}
          role="dialog"
          aria-modal="true"
          aria-label={t("rooms.create")}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-white/70" strokeWidth={1.8} />
                <p className="text-white font-semibold">{t("rooms.create")}</p>
              </div>
              <button
                type="button"
                onClick={closeCreateModal}
                disabled={creating}
                className="text-white/60 hover:text-white disabled:opacity-50"
                aria-label={tr("Жабу", "Закрыть", "Close")}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form className="p-4 space-y-4" onSubmit={submitCreateRoom}>
              <div className="space-y-1.5">
                <label htmlFor="create-room-title" className="text-sm text-white/80">
                  {tr("Бөлме атауы", "Название комнаты", "Room title")}
                </label>
                <input
                  id="create-room-title"
                  value={createRoomTitle}
                  onChange={(e) => setCreateRoomTitle(e.target.value)}
                  placeholder={t("rooms.default_title")}
                  className="w-full rounded-xl border border-white/15 bg-[#0b0b0e] px-3 py-2 text-white placeholder:text-white/45 outline-none appearance-none focus:border-sky-300/40 focus:ring-1 focus:ring-sky-300/25"
                  style={{ WebkitTextFillColor: "#fff" }}
                  maxLength={120}
                />
              </div>

              <label className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">{tr("Жеке бөлме", "Приватная комната", "Private room")}</p>
                  <p className="text-xs text-white/55">{tr("Тек парольмен кіреді", "Вход только по паролю", "Join by password only")}</p>
                </div>
                <input
                  type="checkbox"
                  checked={createRoomPrivate}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setCreateRoomPrivate(next);
                    if (!next) setCreateRoomPassword("");
                  }}
                  className="h-4 w-4 shrink-0 accent-sky-500"
                />
              </label>

              {createRoomPrivate ? (
                <div className="space-y-1.5">
                  <label htmlFor="create-room-password" className="text-sm text-white/80">
                    {tr("Бөлме паролі", "Пароль комнаты", "Room password")}
                  </label>
                  <input
                    id="create-room-password"
                    value={createRoomPassword}
                    onChange={(e) => setCreateRoomPassword(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-[#0b0b0e] px-3 py-2 text-white placeholder:text-white/45 outline-none appearance-none focus:border-sky-300/40 focus:ring-1 focus:ring-sky-300/25"
                    style={{ WebkitTextFillColor: "#fff" }}
                    type="password"
                    autoComplete="off"
                    placeholder={tr("Кемі 4 таңба", "Минимум 4 символа", "At least 4 chars")}
                    minLength={4}
                    required
                  />
                </div>
              ) : null}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  disabled={creating}
                  className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 hover:bg-white/5 disabled:opacity-50"
                >
                  {tr("Бас тарту", "Отмена", "Cancel")}
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-full border border-sky-300/30 bg-sky-400/15 px-4 py-2 text-sm font-medium text-sky-100 hover:bg-sky-400/20 disabled:opacity-60 inline-flex items-center gap-2"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  <span>{t("rooms.create")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <button
        type="button"
        onClick={openCreateModal}
        disabled={creating}
        className="fixed z-[150] right-4 min-[871px]:right-6 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] min-[871px]:bottom-6 h-14 w-14 rounded-full border border-sky-300/35 bg-sky-400/15 text-sky-100 shadow-[0_12px_32px_rgba(56,189,248,0.25)] hover:bg-sky-400/25 active:scale-[0.98] transition grid place-items-center disabled:opacity-60 disabled:cursor-not-allowed"
        aria-label={t("rooms.create")}
        title={t("rooms.create")}
      >
        {creating ? <Loader2 className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
      </button>
    </main>
  );
}

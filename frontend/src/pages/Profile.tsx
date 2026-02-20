import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { api, type TelegramConnectSession, type TelegramStatus } from "../api/client";
import { useAuthStore } from "../store/auth";
import { useFeedStore } from "../store/feed";
import { usePostCacheStore } from "../store/postCache";
import { useProfileMeStore } from "../store/profileMe";
import { useUserStatsStore } from "../store/userStats";
import PostComposer from "../components/PostComposer";
import { DrawingModal } from "../components/DrawingModal";
import { ErrorMessage } from "../components/ErrorMessage";
import { ProfileSkeleton } from "../components/ProfileSkeleton";
import { PostMedia } from "../components/PostMedia";
import { PostMusic } from "../components/PostMusic";
import { Heart, MessageCircle, Eye, X, Plus, Paintbrush, Trash2 } from "lucide-react";
import { highlightHashtags } from "../utils/text";
import { getPostContainerColorClass } from "../utils/postColors";
import { CommentsModal } from "../components/CommentsModal";
import { SocialLinksOverlay, type SocialLinks, type SocialType } from "../components/SocialLinks";
import { MentionPreview } from "../components/MentionPreview";
import { FollowListModal } from "../components/FollowListModal";
import FabricImageEditor from "../components/FabricImageEditor";
import { VerifiedBadge } from "../components/VerifiedBadge";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

const isHalfVisible = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  const viewH = window.innerHeight || document.documentElement.clientHeight;
  const visibleH = Math.min(rect.bottom, viewH) - Math.max(rect.top, 0);
  return visibleH >= rect.height * 0.5;
};

const timeAgo = (iso: string) => {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  const min = Math.floor(sec / 60);
  const hour = Math.floor(min / 60);
  const day = Math.floor(hour / 24);
  if (sec < 45) return "только что";
  if (min < 2) return "минуту назад";
  if (min < 5) return `${min} минуты назад`;
  if (min < 60) return `${min} мин назад`;
  if (hour < 2) return "час назад";
  if (hour < 5) return `${hour} часа назад`;
  if (hour < 24) return `${hour} ч назад`;
  if (day === 1) return "вчера";
  if (day < 7) return `${day} дн назад`;
  return date.toLocaleString();
};

export default function ProfilePage() {
  const token = useAuthStore((s) => s.token);
  const setToken = useAuthStore((s) => s.setToken);
  const navigate = useNavigate();
  const updateFeedByUser = useFeedStore((s) => s.updateByUser);
  const cachedProfile = useProfileMeStore((s) => s.profile);
  const cachedMyPosts = useProfileMeStore((s) => s.myPosts);
  const cachedLikedPosts = useProfileMeStore((s) => s.likedPosts);
  const setCachedProfile = useProfileMeStore((s) => s.setProfile);
  const setCachedMyPosts = useProfileMeStore((s) => s.setMyPosts);
  const setCachedLikedPosts = useProfileMeStore((s) => s.setLikedPosts);
  const setCounts = useUserStatsStore((s) => s.setCounts);

  const postPatches = usePostCacheStore((s) => s.byId);
  const patchPost = usePostCacheStore((s) => s.patch);

  const [profile, setProfile] = useState<any>(cachedProfile);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<"posts" | "liked">("posts");
  const [loadingProfile, setLoadingProfile] = useState(!cachedProfile);
  const [commentsPost, setCommentsPost] = useState<any | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editSection, setEditSection] = useState<"profile" | "password">("profile");
  const [followListMode, setFollowListMode] = useState<"followers" | "following" | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [passwordSuccess, setPasswordSuccess] = useState("");
  const [passwordForm, setPasswordForm] = useState({
    current_password: "",
    new_password: "",
    confirm_password: "",
  });
  const [form, setForm] = useState({
    full_name: "",
    bio: "",
  });
  const [socialLinks, setSocialLinks] = useState<{ type: SocialType; username: string }[]>([]);
  const [socialErrors, setSocialErrors] = useState<Partial<Record<SocialType, string>>>({});
  const [socialDraftOpen, setSocialDraftOpen] = useState(false);
  const [socialDraftType, setSocialDraftType] = useState<SocialType>("instagram");
  const [socialDraftUsername, setSocialDraftUsername] = useState("");
  const [socialDraftError, setSocialDraftError] = useState("");
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus | null>(null);
  const [telegramConnect, setTelegramConnect] = useState<TelegramConnectSession | null>(null);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [telegramActionLoading, setTelegramActionLoading] = useState(false);
  const [telegramAwaitingConfirm, setTelegramAwaitingConfirm] = useState(false);
  const [telegramError, setTelegramError] = useState("");
  const [telegramCopyDone, setTelegramCopyDone] = useState(false);
  const telegramCopyTimerRef = useRef<number | null>(null);
  const telegramConnectPollRef = useRef<number | null>(null);
  const editOpenRef = useRef(false);
  const [avatarPreview, setAvatarPreview] = useState<string>("");
  const [bgPreview, setBgPreview] = useState<string>("");
  const [pendingAvatar, setPendingAvatar] = useState<{ file: File; previewUrl: string } | null>(null);
  const [pendingBackground, setPendingBackground] = useState<{ file: File; previewUrl: string } | null>(null);
  const MAX_MEDIA_BYTES = 5 * 1024 * 1024; // 5MB
  const avatarUploadCtl = useRef<{ version: number; controller: AbortController | null }>({
    version: 0,
    controller: null,
  });
  const bgUploadCtl = useRef<{ version: number; controller: AbortController | null }>({
    version: 0,
    controller: null,
  });
  const [avatarUpload, setAvatarUpload] = useState<{
    uploading: boolean;
    uploadedUrl?: string;
    uploadedKey?: string;
    error?: string;
  }>({ uploading: false });
  const [bgUpload, setBgUpload] = useState<{
    uploading: boolean;
    uploadedUrl?: string;
    uploadedKey?: string;
    error?: string;
  }>({ uploading: false });
  const [drawingTarget, setDrawingTarget] = useState<"background" | "avatar" | null>(null);
  const [cropTarget, setCropTarget] = useState<{
    target: "background" | "avatar";
    srcUrl: string;
    file: File;
  } | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const bgInputRef = useRef<HTMLInputElement | null>(null);
  const bgHeaderRef = useRef<HTMLDivElement | null>(null);
  const [bgCropRatio, setBgCropRatio] = useState<number>(3);

  const seenPosts = useRef<Set<string>>(new Set());
  const loadViewed = () => {
    try {
      const raw = localStorage.getItem("viewed_posts");
      if (!raw) return new Set<string>();
      const arr = JSON.parse(raw);
      return new Set<string>(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set<string>();
    }
  };
  const viewedPersisted = useRef<Set<string>>(loadViewed());
  const pendingTimers = useRef<Map<string, number>>(new Map());
  const observer = useRef<IntersectionObserver | null>(null);

  const [myPosts, setMyPosts] = useState<{ items: any[]; nextOffset: number | null; loading: boolean; loadingMore: boolean; error: string }>(() => ({
    items: cachedMyPosts.items,
    nextOffset: cachedMyPosts.nextOffset,
    loading: false,
    loadingMore: false,
    error: "",
  }));
  const [likedPosts, setLikedPosts] = useState<{ items: any[]; nextOffset: number | null; loading: boolean; loadingMore: boolean; error: string }>(() => ({
    items: cachedLikedPosts.items,
    nextOffset: cachedLikedPosts.nextOffset,
    loading: false,
    loadingMore: false,
    error: "",
  }));
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const observerTabRef = useRef<IntersectionObserver | null>(null);

  const fetchProfile = async () => {
    if (!token) return;
    setLoadingProfile(true);
    try {
      const p = await api.profileMe(token);
      setProfile(p);
      setCachedProfile(p);
      setCounts(p.id, { followers: p.followers, following: p.following });
      setError("");
      loadMyPosts(p.id, 0, false);
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить профиль");
    } finally {
      setLoadingProfile(false);
    }
  };

  const handleLogout = () => {
    setToken(null);
    navigate("/login");
  };

  useEffect(() => {
    if (!token) {
      setProfile(null);
      setError("");
      setLoadingProfile(false);
      setMyPosts({ items: [], nextOffset: null, loading: false, loadingMore: false, error: "" });
      setLikedPosts({ items: [], nextOffset: null, loading: false, loadingMore: false, error: "" });
      return;
    }

    // Если профиль уже загружен — не делаем лишний refetch при навигации.
    if (cachedProfile) {
      setProfile(cachedProfile);
      // Don't overwrite counts that may have been updated optimistically elsewhere in the app.
      const existing = useUserStatsStore.getState().byUserId[cachedProfile.id];
      if (
        typeof existing?.followers !== "number" ||
        typeof existing?.following !== "number"
      ) {
        setCounts(cachedProfile.id, {
          followers: cachedProfile.followers,
          following: cachedProfile.following,
        });
      }
      setError("");
      setLoadingProfile(false);

      // Гидратируем локальный state из кеша, чтобы список постов не "прыгал".
      setMyPosts((prev) => ({
        ...prev,
        items: cachedMyPosts.items,
        nextOffset: cachedMyPosts.nextOffset,
        loading: false,
        loadingMore: false,
        error: "",
      }));
      setLikedPosts((prev) => ({
        ...prev,
        items: cachedLikedPosts.items,
        nextOffset: cachedLikedPosts.nextOffset,
        loading: false,
        loadingMore: false,
        error: "",
      }));

      if (!cachedMyPosts.loaded) {
        loadMyPosts(cachedProfile.id, 0, false);
      }
      return;
    }

    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    editOpenRef.current = editOpen;
  }, [editOpen]);

  useEffect(() => {
    return () => {
      if (telegramCopyTimerRef.current !== null) {
        window.clearTimeout(telegramCopyTimerRef.current);
        telegramCopyTimerRef.current = null;
      }
      if (telegramConnectPollRef.current !== null) {
        window.clearTimeout(telegramConnectPollRef.current);
        telegramConnectPollRef.current = null;
      }
    };
  }, []);

  const stats = useUserStatsStore((s) => (profile?.id ? s.byUserId[profile.id] : undefined));
  const followersCount = typeof stats?.followers === "number" ? stats.followers : profile?.followers ?? 0;
  const followingCount = typeof stats?.following === "number" ? stats.following : profile?.following ?? 0;

  const postsToShow = activeTab === "posts" ? myPosts.items : likedPosts.items;

  const socialTypeOrder: SocialType[] = ["instagram", "telegram", "github", "linkedin"];
  const socialLabel: Record<SocialType, string> = {
    instagram: "Instagram",
    telegram: "Telegram",
    github: "GitHub",
    linkedin: "LinkedIn",
  };
  const socialBaseUrl: Record<SocialType, string> = {
    instagram: "https://instagram.com/",
    telegram: "https://t.me/",
    github: "https://github.com/",
    linkedin: "https://www.linkedin.com/in/",
  };
  const socialPlaceholder: Record<SocialType, string> = {
    instagram: "username",
    telegram: "username или @username",
    github: "username",
    linkedin: "https://www.linkedin.com/in/username",
  };

  const normalizeSocialUsername = (
    type: SocialType,
    raw: string
  ): { username: string; url: string } | { error: string } => {
    const original = String(raw || "").trim();
    if (!original) {
      return {
        error:
          type === "linkedin"
            ? "Введите ссылку LinkedIn или удалите соцсеть"
            : "Введите username или удалите соцсеть",
      };
    }

    // LinkedIn: only full URL, no username-mode.
    if (type === "linkedin") {
      if (!original.startsWith("https://www.linkedin.com/")) {
        return { error: "Ссылка должна начинаться с https://www.linkedin.com/" };
      }
      try {
        const u = new URL(original);
        if (u.protocol !== "https:" || u.hostname.toLowerCase() !== "www.linkedin.com") {
          return { error: "Ссылка должна начинаться с https://www.linkedin.com/" };
        }
      } catch {
        return { error: "Неверная ссылка" };
      }
      return { username: original, url: original };
    }

    const toUrl = (hostAndPath: string) => {
      if (/^https?:\/\//i.test(hostAndPath)) return hostAndPath;
      return `https://${hostAndPath.replace(/^\/+/, "")}`;
    };

    const stripWww = (host: string) => host.toLowerCase().replace(/^www\./, "");

    const extractFromUrl = (u: URL): { username: string } | { error: string } => {
      if (u.protocol !== "https:") return { error: "Ссылка должна начинаться с https://" };
      const host = stripWww(u.hostname);
      const parts = u.pathname.split("/").filter(Boolean);

      if (type === "instagram") {
        if (host !== "instagram.com") return { error: "Ссылка должна вести на instagram.com" };
        const username = parts[0] || "";
        if (!username || username === "p" || username === "reel" || username === "tv" || username === "stories") {
          return { error: "Укажите username профиля Instagram" };
        }
        return { username };
      }

      if (type === "telegram") {
        if (host !== "t.me" && host !== "telegram.me") return { error: "Ссылка должна вести на t.me" };
        const username = (parts[0] === "s" ? parts[1] : parts[0]) || "";
        if (!username || username.startsWith("+")) return { error: "Укажите username профиля Telegram" };
        return { username: username.replace(/^@+/, "") };
      }

      if (type === "github") {
        if (host !== "github.com") return { error: "Ссылка должна вести на github.com" };
        const username = parts[0] || "";
        if (!username) return { error: "Укажите username профиля GitHub" };
        return { username };
      }

      if (type === "linkedin") {
        if (host !== "linkedin.com") return { error: "Ссылка должна вести на linkedin.com" };
        const username = parts[0] === "in" ? parts[1] || "" : "";
        if (!username) return { error: "Укажите username профиля LinkedIn" };
        return { username };
      }

      return { error: "Неизвестный тип соцсети" };
    };

    const fromUrlMaybe = () => {
      // if user pasted domain without scheme, URL() will fail - add https://.
      const v = original.replace(/\s+/g, "");
      const looksLikeUrl =
        /^https?:\/\//i.test(v) ||
        v.startsWith("www.") ||
        v.includes("instagram.com") ||
        v.includes("t.me") ||
        v.includes("telegram.me") ||
        v.includes("github.com") ||
        v.includes("linkedin.com");
      if (!looksLikeUrl) return null;
      try {
        const u = new URL(toUrl(v));
        return extractFromUrl(u);
      } catch {
        return { error: "Неверная ссылка" } as const;
      }
    };

    let username = original.trim();

    const urlParsed = fromUrlMaybe();
    if (urlParsed) {
      if ("error" in urlParsed) return urlParsed;
      username = urlParsed.username;
    }

    username = username.trim().replace(/^@+/, "");

    const invalid = () =>
      ({ error: "Некорректный username: используйте буквы/цифры и допустимые символы" }) as const;

    if (type === "github") {
      // GitHub: alnum and hyphen; can't start/end with hyphen; max 39 chars.
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(username)) return invalid();
    } else if (type === "telegram") {
      // Telegram: letters/digits/underscore.
      if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) return invalid();
    } else if (type === "instagram") {
      // Instagram: letters/digits/._ (underscore allowed).
      if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return invalid();
    } else if (type === "linkedin") {
      // LinkedIn slug is usually letters/digits/hyphen.
      if (!/^[A-Za-z0-9-]{1,100}$/.test(username)) return invalid();
    }

    return { username, url: `${socialBaseUrl[type]}${username}` };
  };

  const extractSocialUsername = (type: SocialType, url: string): string => {
    const v = String(url || "").trim();
    if (!v) return "";
    if (type === "linkedin") return v;
    try {
      const u = new URL(v);
      const res = normalizeSocialUsername(type, u.toString());
      return "error" in res ? "" : res.username;
    } catch {
      return "";
    }
  };

  const stopTelegramConnectPolling = (resetAwaiting = true) => {
    if (telegramConnectPollRef.current !== null) {
      window.clearTimeout(telegramConnectPollRef.current);
      telegramConnectPollRef.current = null;
    }
    if (resetAwaiting) setTelegramAwaitingConfirm(false);
  };

  const loadTelegramStatus = async (opts?: { silent?: boolean }) => {
    if (!token) return;
    const silent = opts?.silent === true;
    if (!silent) {
      setTelegramLoading(true);
      setTelegramError("");
    }
    try {
      const status = await api.telegramStatus(token);
      setTelegramStatus(status);
      if (status.connected) {
        stopTelegramConnectPolling();
        setTelegramConnect(null);
      }
      return status;
    } catch (e: any) {
      if (!silent) setTelegramError(e?.message || "Не удалось получить статус Telegram");
      return null;
    } finally {
      if (!silent) setTelegramLoading(false);
    }
  };

  const startTelegramConnectPolling = () => {
    if (!token) return;
    stopTelegramConnectPolling(false);
    setTelegramAwaitingConfirm(true);
    const deadline = Date.now() + 2 * 60 * 1000;

    const tick = async () => {
      const status = await loadTelegramStatus({ silent: true });
      if (status?.connected) {
        stopTelegramConnectPolling();
        return;
      }
      if (!editOpenRef.current || Date.now() >= deadline) {
        stopTelegramConnectPolling();
        return;
      }
      telegramConnectPollRef.current = window.setTimeout(() => {
        void tick();
      }, 1500);
    };

    void tick();
  };

  const handleCreateTelegramCode = async () => {
    if (!token) return;
    let botWindow: Window | null = null;
    if (typeof window !== "undefined") {
      botWindow = window.open("", "_blank");
    }
    setTelegramActionLoading(true);
    setTelegramError("");
    try {
      const session = await api.telegramConnect(token);
      setTelegramConnect(session);
      const deepLink = String(session?.deep_link || "").trim();
      if (deepLink) {
        if (botWindow && !botWindow.closed) {
          botWindow.location.href = deepLink;
          try {
            botWindow.opener = null;
          } catch {}
        } else {
          window.open(deepLink, "_blank", "noopener,noreferrer");
        }
      } else if (botWindow && !botWindow.closed) {
        botWindow.close();
      }
      await loadTelegramStatus({ silent: true });
      startTelegramConnectPolling();
    } catch (e: any) {
      if (botWindow && !botWindow.closed) {
        botWindow.close();
      }
      setTelegramError(e?.message || "Не удалось создать код подключения");
      stopTelegramConnectPolling();
    } finally {
      setTelegramActionLoading(false);
    }
  };

  const handleDisconnectTelegram = async () => {
    if (!token) return;
    setTelegramActionLoading(true);
    setTelegramError("");
    try {
      await api.telegramDisconnect(token);
      stopTelegramConnectPolling();
      setTelegramConnect(null);
      await loadTelegramStatus();
    } catch (e: any) {
      setTelegramError(e?.message || "Не удалось отключить Telegram");
    } finally {
      setTelegramActionLoading(false);
    }
  };

  const handleCopyTelegramCode = async () => {
    const code = telegramConnect?.start_code?.trim();
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setTelegramCopyDone(true);
      if (telegramCopyTimerRef.current !== null) {
        window.clearTimeout(telegramCopyTimerRef.current);
      }
      telegramCopyTimerRef.current = window.setTimeout(() => {
        setTelegramCopyDone(false);
        telegramCopyTimerRef.current = null;
      }, 1300);
    } catch {
      setTelegramError("Не удалось скопировать код");
    }
  };

  const openEdit = () => {
    if (!profile) return;
    closeCrop();
    if (pendingAvatar) URL.revokeObjectURL(pendingAvatar.previewUrl);
    if (pendingBackground) URL.revokeObjectURL(pendingBackground.previewUrl);
    setPendingAvatar(null);
    setPendingBackground(null);
    avatarUploadCtl.current.controller?.abort();
    bgUploadCtl.current.controller?.abort();
    avatarUploadCtl.current = { version: 0, controller: null };
    bgUploadCtl.current = { version: 0, controller: null };
    setAvatarUpload({ uploading: false });
    setBgUpload({ uploading: false });
    setForm({
      full_name: profile.full_name || "",
      bio: profile.bio || "",
    });
    const links = (profile.social_links || {}) as SocialLinks;
    const nextSocial = socialTypeOrder.flatMap((t) => {
      const url = typeof links?.[t] === "string" ? String(links[t]).trim() : "";
      const username = url ? extractSocialUsername(t, url) : "";
      return username ? [{ type: t, username }] : [];
    });
    setSocialLinks(nextSocial);
    setSocialErrors({});
    setSocialDraftOpen(false);
    setSocialDraftUsername("");
    setSocialDraftError("");
    setAvatarPreview(profile.avatar_url || "");
    setBgPreview(profile.background_url || "");
    setDrawingTarget(null);
    setSaveError("");
    setPasswordError("");
    setPasswordSuccess("");
    setPasswordForm({
      current_password: "",
      new_password: "",
      confirm_password: "",
    });
    setTelegramStatus(null);
    setTelegramConnect(null);
    setTelegramError("");
    setTelegramCopyDone(false);
    setTelegramAwaitingConfirm(false);
    setEditSection("profile");
    setEditOpen(true);
    void loadTelegramStatus();
  };

  const closeEditModal = () => {
    setDrawingTarget(null);
    clearPendingImages();
    avatarUploadCtl.current.controller?.abort();
    bgUploadCtl.current.controller?.abort();
    avatarUploadCtl.current = { version: 0, controller: null };
    bgUploadCtl.current = { version: 0, controller: null };
    setAvatarUpload({ uploading: false });
    setBgUpload({ uploading: false });
    closeCrop();
    setPasswordError("");
    setPasswordSuccess("");
    setPasswordForm({
      current_password: "",
      new_password: "",
      confirm_password: "",
    });
    if (telegramCopyTimerRef.current !== null) {
      window.clearTimeout(telegramCopyTimerRef.current);
      telegramCopyTimerRef.current = null;
    }
    stopTelegramConnectPolling();
    setTelegramStatus(null);
    setTelegramConnect(null);
    setTelegramError("");
    setTelegramCopyDone(false);
    setEditSection("profile");
    setEditOpen(false);
  };

  const clearPendingImages = () => {
    if (pendingAvatar) URL.revokeObjectURL(pendingAvatar.previewUrl);
    if (pendingBackground) URL.revokeObjectURL(pendingBackground.previewUrl);
    setPendingAvatar(null);
    setPendingBackground(null);
  };

  const uploadProfileMediaNow = async (target: "background" | "avatar", file: File) => {
    if (!token) return;

    const isAvatar = target === "avatar";
    const ctl = isAvatar ? avatarUploadCtl : bgUploadCtl;
    const setState = isAvatar ? setAvatarUpload : setBgUpload;

    ctl.current.controller?.abort();
    const controller = new AbortController();
    ctl.current.controller = controller;
    ctl.current.version += 1;
    const version = ctl.current.version;

    setState({ uploading: true, uploadedUrl: undefined, uploadedKey: undefined, error: undefined });

    try {
      const uploadFile = file;
      if (!uploadFile.type.startsWith("image/") || uploadFile.type === "image/svg+xml") {
        throw new Error("Можно загрузить только изображения");
      }
      if (uploadFile.size > MAX_MEDIA_BYTES) {
        throw new Error("Изображение не должно превышать 5 МБ");
      }

      const presigned = await api.presignMedia(
        [{ content_type: uploadFile.type, size_bytes: uploadFile.size }],
        target,
        token
      );
      const p = presigned[0];
      if (!p) throw new Error("Не удалось подготовить загрузку");

      await api.uploadPresignedPut(p, uploadFile, controller.signal);

      if (ctl.current.version !== version) return;
      setState({ uploading: false, uploadedUrl: p.url, uploadedKey: p.key, error: undefined });
    } catch (e: any) {
      if (controller.signal.aborted) return;
      if (ctl.current.version !== version) return;
      const msg = e?.message || "Не удалось загрузить файл";
      setState({ uploading: false, uploadedUrl: undefined, uploadedKey: undefined, error: msg });
      setSaveError(msg);
    }
  };

  const applyPendingImage = (target: "background" | "avatar", file: File) => {
    const url = URL.createObjectURL(file);
    if (target === "avatar") {
      if (pendingAvatar) URL.revokeObjectURL(pendingAvatar.previewUrl);
      setPendingAvatar({ file, previewUrl: url });
      setAvatarPreview(url);
    } else {
      if (pendingBackground) URL.revokeObjectURL(pendingBackground.previewUrl);
      setPendingBackground({ file, previewUrl: url });
      setBgPreview(url);
    }

    // Upload immediately (like posts): presign -> direct PUT to storage.
    void uploadProfileMediaNow(target, file);
  };

  const closeCrop = () => {
    if (cropTarget) URL.revokeObjectURL(cropTarget.srcUrl);
    setCropTarget(null);
  };

  const setPendingImage = (target: "background" | "avatar", file: File) => {
    if (!file.type.startsWith("image/") || file.type === "image/svg+xml") {
      setSaveError("Можно загрузить только изображения");
      return;
    }
    setSaveError("");

    // Cropping GIF would flatten the animation. Keep GIFs as-is.
    if (file.type === "image/gif") {
      applyPendingImage(target, file);
      return;
    }

    // Open crop modal for still images.
    if (cropTarget) URL.revokeObjectURL(cropTarget.srcUrl);
    const srcUrl = URL.createObjectURL(file);
    setCropTarget({ target, srcUrl, file });
  };

  const handleSave = async () => {
    if (!token || !profile) return;
    setSaveError("");
    const nextErrors: Partial<Record<SocialType, string>> = {};
    const normalizedList: { type: SocialType; username: string }[] = [];
    const social_links: SocialLinks = {} as SocialLinks;
    socialLinks.forEach((it) => {
      const res = normalizeSocialUsername(it.type, it.username);
      if ("error" in res) {
        nextErrors[it.type] = res.error;
        normalizedList.push(it);
        return;
      }
      social_links[it.type] = res.url;
      normalizedList.push({ type: it.type, username: res.username });
    });
    setSocialErrors(nextErrors);
    setSocialLinks(normalizedList);
    if (Object.keys(nextErrors).length > 0) {
      setSaveError("Проверьте ссылки на соцсети");
      return;
    }

    if (avatarUpload.uploading || bgUpload.uploading) {
      setSaveError("Дождитесь завершения загрузки медиа");
      return;
    }
    if (pendingAvatar && !avatarUpload.uploadedUrl) {
      setSaveError(avatarUpload.error || "Не удалось загрузить аватар");
      return;
    }
    if (pendingBackground && !bgUpload.uploadedUrl) {
      setSaveError(bgUpload.error || "Не удалось загрузить фон");
      return;
    }

    setSaving(true);
    const payload = {
      full_name: form.full_name.trim(),
      bio: form.bio.trim(),
      social_links,
    };
    try {
      const avatarURL = pendingAvatar ? avatarUpload.uploadedUrl : undefined;
      const backgroundURL = pendingBackground ? bgUpload.uploadedUrl : undefined;

      const updated = await api.updateProfile(
        {
          ...payload,
          ...(avatarURL ? { avatar_url: avatarURL } : {}),
          ...(backgroundURL ? { background_url: backgroundURL } : {}),
        },
        token
      );
      setProfile(updated);
      setCachedProfile(updated);
      updateFeedByUser(updated.id, {
        full_name: updated.full_name,
        username: updated.username,
        avatar_url: updated.avatar_url,
        background_url: updated.background_url,
      });
      clearPendingImages();
      setAvatarUpload({ uploading: false });
      setBgUpload({ uploading: false });
      setAvatarPreview(updated.avatar_url || "");
      setBgPreview(updated.background_url || "");
      closeCrop();
      setEditOpen(false);
    } catch (e: any) {
      setSaveError(e.message || "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!token) return;
    setPasswordError("");
    setPasswordSuccess("");

    if (!passwordForm.current_password.trim()) {
      setPasswordError("Введите текущий пароль");
      return;
    }
    if (passwordForm.new_password.length < 8) {
      setPasswordError("Новый пароль должен быть минимум 8 символов");
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordError("Новый пароль и подтверждение не совпадают");
      return;
    }

    setPasswordSaving(true);
    try {
      await api.changePassword(
        {
          current_password: passwordForm.current_password,
          new_password: passwordForm.new_password,
        },
        token
      );
      setPasswordForm({
        current_password: "",
        new_password: "",
        confirm_password: "",
      });
      setPasswordSuccess("Пароль успешно изменен");
    } catch (e: any) {
      setPasswordError(e.message || "Не удалось изменить пароль");
    } finally {
      setPasswordSaving(false);
    }
  };

  // Compute the real aspect ratio of the profile background container for WYSIWYG crop/drawing.
  useEffect(() => {
    const el = bgHeaderRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setBgCropRatio(r.width / r.height);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [profile?.id]);

  useEffect(() => {
    if (!token) return;
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const target = entry.target as HTMLElement;
          const id = target.getAttribute("data-post-id");
          if (!id) return;
          if (seenPosts.current.has(id) || viewedPersisted.current.has(id)) {
            obs.unobserve(target);
            return;
          }
          if (!entry.isIntersecting) {
            const pending = pendingTimers.current.get(id);
            if (pending) {
              clearTimeout(pending);
              pendingTimers.current.delete(id);
            }
            return;
          }
          if (pendingTimers.current.has(id)) return;
    const timer = window.setTimeout(() => {
      pendingTimers.current.delete(id);
      if (seenPosts.current.has(id) || viewedPersisted.current.has(id)) return;
      if (!isHalfVisible(target)) return;
      sendView(id);
            seenPosts.current.add(id);
            obs.unobserve(target);
          }, 1000);
          pendingTimers.current.set(id, timer);
        });
      },
      { threshold: 0.5 }
    );
    observer.current = obs;
    return () => {
      obs.disconnect();
      pendingTimers.current.forEach((t) => clearTimeout(t));
      pendingTimers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, postsToShow]);

  const updatePost = (id: string, patch: Partial<any>) => {
    setMyPosts((prev) => ({ ...prev, items: prev.items.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    setLikedPosts((prev) => ({ ...prev, items: prev.items.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    setCommentsPost((prev) => (prev?.id === id ? { ...prev, ...patch } : prev));
  };

  const toggleLike = async (id: string, liked: boolean) => {
    if (!token) return;
    const prevLikedItems = likedPosts.items;
    const prevLikedNext = likedPosts.nextOffset;
    const removeFromLiked = liked && prevLikedItems.some((p) => p.id === id);
    const currentBase =
      myPosts.items.find((p) => p.id === id) ||
      likedPosts.items.find((p) => p.id === id);
    const currentPatch = postPatches[id];
    const current = currentPatch ? { ...currentBase, ...currentPatch } : currentBase;
    const currentLikeCount = current?.like_count ?? 0;
    const nextCount = currentLikeCount + (liked ? -1 : 1);
    updatePost(id, { liked_by_me: !liked, like_count: nextCount });
    patchPost(id, { liked_by_me: !liked, like_count: nextCount });
    if (removeFromLiked) {
      setLikedPosts((prev) => ({ ...prev, items: prev.items.filter((p) => p.id !== id) }));
      setCachedLikedPosts(prevLikedItems.filter((p) => p.id !== id), prevLikedNext, true);
    }
    try {
      if (liked) await api.unlikePost(id, token);
      else await api.likePost(id, token);
    } catch {
      if (current) {
        updatePost(id, { liked_by_me: liked, like_count: currentLikeCount });
        patchPost(id, { liked_by_me: liked, like_count: currentLikeCount });
      }
      if (removeFromLiked) {
        setLikedPosts((prev) => ({ ...prev, items: prevLikedItems }));
        setCachedLikedPosts(prevLikedItems, prevLikedNext, true);
      }
    }
  };

  const sendView = async (postId: string) => {
    if (!token) return;
    if (viewedPersisted.current.has(postId)) return;
    try {
      await api.viewPost(postId, token);
      updatePost(postId, { view_count: 1 + (myPosts.items.find((p) => p.id === postId)?.view_count || likedPosts.items.find((p) => p.id === postId)?.view_count || 0) });
      viewedPersisted.current.add(postId);
      try {
        localStorage.setItem("viewed_posts", JSON.stringify(Array.from(viewedPersisted.current)));
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  };

  const loadMyPosts = async (userId: string, offset = 0, append = false) => {
    setMyPosts((prev) => ({ ...prev, loading: !append, loadingMore: append }));
    try {
      const { items, nextOffset } = await api.userPosts(userId, 20, offset, token);
      setMyPosts((prev) => {
        const nextItems = append ? [...prev.items, ...items] : items;
        setCachedMyPosts(nextItems, nextOffset, true);
        return {
          items: nextItems,
          nextOffset,
          loading: false,
          loadingMore: false,
          error: "",
        };
      });
    } catch (e: any) {
      setMyPosts((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: e.message || "Не удалось загрузить посты",
      }));
    }
  };

  const loadLikedPosts = async (offset = 0, append = false) => {
    setLikedPosts((prev) => ({ ...prev, loading: !append, loadingMore: append }));
    try {
      const { items, nextOffset } = await api.likedPosts(20, offset, token);
      setLikedPosts((prev) => {
        const nextItems = append ? [...prev.items, ...items] : items;
        setCachedLikedPosts(nextItems, nextOffset, true);
        return {
          items: nextItems,
          nextOffset,
          loading: false,
          loadingMore: false,
          error: "",
        };
      });
    } catch (e: any) {
      setLikedPosts((prev) => ({
        ...prev,
        loading: false,
        loadingMore: false,
        error: e.message || "Не удалось загрузить понравившиеся",
      }));
    }
  };

  const prevTabRef = useRef<"posts" | "liked">(activeTab);
  useEffect(() => {
    if (!profile) return;
    const prevTab = prevTabRef.current;
    prevTabRef.current = activeTab;
    // Always refresh "liked" on tab switch to avoid stale cached state.
    if (activeTab === "liked" && prevTab !== "liked" && !likedPosts.loading) {
      loadLikedPosts(0, false);
    }
  }, [activeTab, profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (observerTabRef.current) observerTabRef.current.disconnect();
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    observerTabRef.current = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry.isIntersecting) return;
        if (activeTab === "posts" && myPosts.nextOffset !== null && !myPosts.loadingMore && !myPosts.loading && profile) {
          loadMyPosts(profile.id, myPosts.nextOffset, true);
        }
        if (activeTab === "liked" && likedPosts.nextOffset !== null && !likedPosts.loadingMore && !likedPosts.loading) {
          loadLikedPosts(likedPosts.nextOffset, true);
        }
      },
      { rootMargin: "200px 0px" }
    );
    observerTabRef.current.observe(sentinel);
    return () => observerTabRef.current?.disconnect();
  }, [activeTab, myPosts.nextOffset, likedPosts.nextOffset, myPosts.loadingMore, likedPosts.loadingMore, profile]); // eslint-disable-line react-hooks/exhaustive-deps

  const setPostRef = (id: string) => (el: HTMLElement | null) => {
    if (!observer.current || !el) return;
    observer.current.observe(el);
  };

  if (loadingProfile && !profile && !error) {
    return (
      <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
        <ProfileSkeleton />
      </div>
    );
  }

  if (!loadingProfile && !profile) {
    return (
      <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
        <ErrorMessage message={error || "Не удалось загрузить профиль"} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={fetchProfile}
            className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40 transition"
          >
            Повторить
          </button>
        </div>
      </div>
    );
  }

  const postsLoading = activeTab === "posts" ? myPosts.loading : likedPosts.loading;
  const usedSocialTypes = new Set(socialLinks.map((l) => l.type));
  const availableSocialTypes = socialTypeOrder.filter((t) => !usedSocialTypes.has(t));

  return (
    <div data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-6 page-fade">
      <ErrorMessage message={error} />
      <div className="rounded-2xl border border-white/10 overflow-hidden bg-black shadow-xl">
        <div ref={bgHeaderRef} className="relative h-40 md:h-52 overflow-hidden">
          <div className="absolute inset-0">
            {profile?.background_url ? (
              <img src={profile.background_url} alt="cover" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900" />
            )}
          </div>
        </div>
        <div className="px-4 pb-5 pt-6 md:pt-8 flex flex-col md:flex-row md:items-start md:justify-between gap-4 relative">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-black flex items-center justify-center text-3xl font-semibold text-white overflow-hidden absolute -top-14">
                {profile?.avatar_url ? (
                  <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <span>{profile?.full_name?.[0]?.toUpperCase() || "?"}</span>
                )}
              </div>
              <div className="mt-12 space-y-2">
                <p className="text-xl font-semibold text-white inline-flex items-center gap-[3px]">
                  <span>{profile?.full_name || ""}</span>
                  {profile?.is_verified ? <VerifiedBadge /> : null}
                </p>
                <p className="text-white/60">@{profile?.username}</p>
                <p className="text-white/50 text-sm">На сайте с {profile?.created_at ? formatDate(profile.created_at) : "--"}</p>
                {profile?.bio ? (
                  <p className="text-white/70 text-sm">{profile.bio}</p>
                ) : (
                  <p className="text-white/40 text-sm">Нет описания</p>
                )}
                <div className="flex items-center gap-5 text-white/80 pt-1 text-sm">
                  <button
                    type="button"
                    onClick={() => setFollowListMode("followers")}
                    className="flex items-baseline gap-1 hover:text-white transition cursor-pointer"
                    title="Посмотреть подписчиков"
                  >
                    <span className="font-semibold text-white text-base">{followersCount}</span>
                    <span className="text-white/60 hover:underline">Подписчики</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFollowListMode("following")}
                    className="flex items-baseline gap-1 hover:text-white transition cursor-pointer"
                    title="Посмотреть подписки"
                  >
                    <span className="font-semibold text-white text-base">{followingCount}</span>
                    <span className="text-white/60 hover:underline">Подписки</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="md:pt-0 pt-2 flex md:justify-end gap-2">
            <button
              className="rounded-full border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40 transition self-start"
              onClick={openEdit}
            >
              Редактировать
            </button>
            <button
              className="min-[871px]:hidden rounded-full border border-red-400/40 px-4 py-2 text-sm text-red-300 hover:border-red-300/70 hover:text-red-200 transition self-start"
              onClick={handleLogout}
            >
              Выйти
            </button>
          </div>
          <SocialLinksOverlay
            links={profile?.social_links}
            className="absolute bottom-4 right-4 flex items-center gap-2"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur p-4 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <button
            className={`px-4 py-2 rounded-full text-sm font-semibold ${activeTab === "posts" ? "bg-white text-black" : "text-white/70 hover:text-white"}`}
            onClick={() => setActiveTab("posts")}
          >
            Посты
          </button>
          <button
            className={`px-4 py-2 rounded-full text-sm font-semibold ${activeTab === "liked" ? "bg-white text-black" : "text-white/70 hover:text-white"}`}
            onClick={() => setActiveTab("liked")}
          >
            Понравившиеся
          </button>
        </div>

        {activeTab === "posts" && (
          <PostComposer
            onCreated={() => {
              if (profile) {
                loadMyPosts(profile.id, 0, false);
              }
            }}
          />
        )}

        <div className="space-y-3">
          {postsLoading && (
            <>
              {[1, 2, 3].map((n) => (
                <div key={n} className="card p-4 md:p-4 animate-pulse space-y-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-white/10" />
                      <div className="space-y-2">
                        <div className="h-3 w-32 bg-white/10 rounded-full" />
                        <div className="h-2 w-20 bg-white/5 rounded-full" />
                      </div>
                    </div>
                    <div className="h-8 w-24 rounded-full bg-white/5" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-white/10 rounded-full" />
                    <div className="h-3 w-5/6 bg-white/10 rounded-full" />
                    <div className="h-3 w-2/3 bg-white/10 rounded-full" />
                  </div>
                  <div className="h-40 rounded-2xl bg-white/5" />
                  <div className="flex items-center justify-between pt-1">
                    <div className="h-8 w-28 rounded-full bg-white/5" />
                    <div className="h-8 w-16 rounded-full bg-white/5" />
                  </div>
                </div>
              ))}
            </>
          )}

          {!postsLoading && postsToShow.length === 0 && (
            <div className="py-8 flex justify-center">
              <p className="text-white/60 text-sm">Пока нет постов</p>
            </div>
          )}

          {!postsLoading &&
            postsToShow.map((p) => {
              const patch = postPatches[p.id];
              const item = patch ? { ...p, ...patch } : p;
              const postColorClass = getPostContainerColorClass(item.container_color);

              return (
              <article
                key={p.id}
                ref={setPostRef(p.id)}
                data-post-id={p.id}
                className={`card p-4 md:p-4 transition hover:border-white/25 relative overflow-hidden ${postColorClass}`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/u/${p.username}`}
                      aria-label={`Профиль ${p.full_name || p.username}`}
                      className="relative w-10 h-10 rounded-full bg-white/10 overflow-hidden flex items-center justify-center text-sm font-semibold hover:opacity-90"
                    >
                      <span aria-hidden>{p.full_name?.[0]?.toUpperCase() || p.username[0].toUpperCase()}</span>
                      {p.avatar_url ? (
                        <img
                          src={p.avatar_url}
                          alt=""
                          className="absolute inset-0 w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                          draggable={false}
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                      ) : null}
                    </Link>
                    <div>
                      <MentionPreview username={p.username} className="">
                        <Link
                          to={`/u/${p.username}`}
                          className="text-white font-semibold leading-tight flex items-center gap-[3px] hover:underline"
                        >
                          <span>{p.full_name || "Без имени"}</span>
                          {p.is_verified ? <VerifiedBadge /> : null}
                        </Link>
                      </MentionPreview>
                      <p className="text-sm text-white/60">{timeAgo(p.created_at)}</p>
                    </div>
                  </div>
                </div>

                <p className="mt-3 text-white leading-relaxed break-words">
                  {highlightHashtags(
                    p.content,
                    p.mentions ? new Set(p.mentions.map((m: string) => m.toLowerCase())) : undefined,
                    p.hashtags ? new Set(p.hashtags.map((h: string) => h.toLowerCase())) : undefined
                  )}
                </p>

                <PostMedia media={item.media} />
                <PostMusic music={item.music} />

                <div className="mt-4 flex items-center justify-between text-sm text-white/60">
                  <div className="flex items-center gap-6">
                    <button
                      onClick={() => toggleLike(item.id, item.liked_by_me)}
                      className={`flex items-center gap-2 px-2 py-1 rounded-full transition ${
                        item.liked_by_me ? "text-red-400" : "text-white/70 hover:text-white"
                      }`}
                    >
                      {item.liked_by_me ? (
                        <Heart className="w-5 h-5 fill-current" strokeWidth={1.7} />
                      ) : (
                        <Heart className="w-5 h-5" strokeWidth={1.7} />
                      )}
                      <span className="font-medium">{item.like_count}</span>
                    </button>

                    <button
                      className="flex items-center gap-2 text-white/60 hover:text-white"
                      onClick={() => setCommentsPost(item)}
                    >
                      <MessageCircle className="w-5 h-5" strokeWidth={1.7} />
                      <span>{item.comment_count ?? 0}</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-white/60">
                    <Eye className="w-5 h-5" strokeWidth={1.7} />
                    <span>{item.view_count ?? 0}</span>
                  </div>
                </div>
              </article>
              );
            })}
        </div>
        <div ref={sentinelRef} className="min-h-[1px] flex items-center justify-center text-white/60 text-sm">
          {activeTab === "posts"
            ? myPosts.loadingMore
              ? "Загружаем..."
              : myPosts.nextOffset !== null
                ? "Прокрутите, чтобы загрузить ещё"
                : ""
            : likedPosts.loadingMore
              ? "Загружаем..."
              : likedPosts.nextOffset !== null
                ? "Прокрутите, чтобы загрузить ещё"
                : ""}
        </div>
      </div>

      <FollowListModal
        open={followListMode !== null}
        mode={followListMode || "followers"}
        userId={profile?.id || ""}
        token={token}
        onClose={() => setFollowListMode(null)}
      />
      {commentsPost && (
        <CommentsModal
          post={commentsPost}
          onUpdatePost={updatePost}
          onClose={() => setCommentsPost(null)}
        />
      )}

      {editOpen &&
        createPortal(
          <div className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-md overflow-y-auto">
            <div className="min-h-screen w-full flex items-center justify-center px-4 py-8">
              <div className="bg-[#0b0b0f] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden">
                <button
                  className="absolute top-3 right-3 text-white/60 hover:text-white"
                  onClick={closeEditModal}
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="px-7 pt-7 pb-4 shrink-0">
                  <h3 className="text-lg font-semibold text-white">Настройки профиля</h3>
                  <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.03] p-1 grid grid-cols-2 gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditSection("profile");
                        setPasswordError("");
                        setPasswordSuccess("");
                      }}
                      className={`rounded-lg px-3 py-2 text-sm transition ${
                        editSection === "profile"
                          ? "bg-white text-black font-medium"
                          : "text-white/70 hover:text-white"
                      }`}
                    >
                      Оформление профиля
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditSection("password");
                        setSaveError("");
                      }}
                      className={`rounded-lg px-3 py-2 text-sm transition ${
                        editSection === "password"
                          ? "bg-white text-black font-medium"
                          : "text-white/70 hover:text-white"
                      }`}
                    >
                      Поменять пароль
                    </button>
                  </div>
                </div>

                <div className="px-7 pb-6 overflow-y-auto overflow-x-hidden flex-1">
                  {editSection === "profile" ? (
                    <>
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <p className="text-sm text-white/60">Фон</p>
                      <div className="relative overflow-visible">
                        <div className="relative h-36 rounded-xl overflow-hidden bg-gradient-to-r from-slate-800 via-slate-700 to-slate-900">
                          {bgPreview ? (
                            <img src={bgPreview} alt="background" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full" />
                          )}
                          {bgUpload.uploading && (
                            <div className="pointer-events-none absolute inset-0 z-10 bg-black/45 flex items-center justify-center">
                              <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            </div>
                          )}
                          <div className="absolute right-3 bottom-3 flex items-center gap-2">
                            <button
                              className="w-8 h-8 rounded-full bg-black/60 text-white border border-white/20 hover:border-white/40 flex items-center justify-center"
                              onClick={() => setDrawingTarget("background")}
                              aria-label="Рисовать фон"
                              disabled={saving}
                            >
                              <Paintbrush className="w-4 h-4" />
                            </button>
                            <button
                              className="w-8 h-8 rounded-full bg-black/60 text-white border border-white/20 hover:border-white/40 flex items-center justify-center"
                              onClick={() => bgInputRef.current?.click()}
                              aria-label={bgPreview ? "Изменить фон" : "Добавить фон"}
                              disabled={saving}
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                          </div>
                          <input
                            ref={bgInputRef}
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              e.currentTarget.value = "";
                              setPendingImage("background", file);
                            }}
                          />
                        </div>

                        <div className="absolute left-0 bottom-0 translate-y-1/2 z-10">
                          <div className="relative w-[88px] h-[88px]">
                            <div className="w-full h-full rounded-full bg-black flex items-center justify-center text-2xl font-semibold text-white overflow-hidden relative z-10 shadow-lg shadow-black/40">
                              {avatarPreview ? (
                                <img src={avatarPreview} alt="avatar" className="w-full h-full object-cover" />
                              ) : (
                                <span>{form.full_name?.[0]?.toUpperCase() || "?"}</span>
                              )}
                              {avatarUpload.uploading && (
                                <div className="pointer-events-none absolute inset-0 z-10 bg-black/45 flex items-center justify-center">
                                  <div className="h-7 w-7 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                                </div>
                              )}
                            </div>
                            <div className="absolute -right-2 bottom-0 flex flex-col gap-2 z-20">
                              <button
                                className="w-8 h-8 rounded-full bg-white text-black border border-white/40 hover:bg-white/90 flex items-center justify-center"
                                onClick={() => setDrawingTarget("avatar")}
                                aria-label="Рисовать аватар"
                                disabled={saving}
                              >
                                <Paintbrush className="w-4 h-4" />
                              </button>
                              <button
                                className="w-8 h-8 rounded-full bg-white text-black border border-white/40 hover:bg-white/90 flex items-center justify-center"
                                onClick={() => avatarInputRef.current?.click()}
                                aria-label={avatarPreview ? "Изменить аватар" : "Добавить аватар"}
                                disabled={saving}
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                            </div>
                            <input
                              ref={avatarInputRef}
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                e.currentTarget.value = "";
                                setPendingImage("avatar", file);
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 mt-14 md:mt-16">
                    <div className="mt-0">
                      <label className="block text-sm text-white/60 mb-1.5">Полное имя</label>
                      <input
                        value={form.full_name}
                        onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
                        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:border-white/40 outline-none"
                        placeholder="Ваше имя"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-white/60 mb-1.5">Описание</label>
                      <textarea
                        value={form.bio}
                        onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                        maxLength={240}
                        rows={3}
                        className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:border-white/40 outline-none resize-none"
                        placeholder="Например, чем вы занимаетесь или что вам интересно"
                      />
                      <p className="mt-1 text-xs text-white/40">{form.bio.length}/240</p>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm text-white/60">Социальные сети</label>

                      {socialLinks.length > 0 && (
                        <div className="space-y-3">
                          {socialLinks.map((it) => (
                            <div key={it.type} className="flex items-start gap-2">
                              <div className="w-24 pt-2 text-xs text-white/60">
                                {socialLabel[it.type]}
                              </div>
                              <div className="flex-1">
                                <input
                                  value={it.username}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    setSocialLinks((prev) =>
                                      prev.map((p) =>
                                        p.type === it.type ? { ...p, username: v } : p
                                      )
                                    );
                                    setSocialErrors((prev) => {
                                      if (!prev[it.type]) return prev;
                                      const next = { ...prev };
                                      delete next[it.type];
                                      return next;
                                    });
                                  }}
                                  onBlur={(e) => {
                                    const res = normalizeSocialUsername(it.type, e.target.value);
                                    setSocialErrors((prev) => {
                                      const next = { ...prev };
                                      if ("error" in res) next[it.type] = res.error;
                                      else delete next[it.type];
                                      return next;
                                    });
                                    if (!("error" in res)) {
                                      setSocialLinks((prev) =>
                                        prev.map((p) =>
                                          p.type === it.type ? { ...p, username: res.username } : p
                                        )
                                      );
                                    }
                                  }}
                                  className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:border-white/40 outline-none text-sm"
                                  placeholder={socialPlaceholder[it.type]}
                                />
                                {socialErrors[it.type] && (
                                  <p className="mt-1 text-xs text-red-300">
                                    {socialErrors[it.type]}
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSocialLinks((prev) =>
                                    prev.filter((p) => p.type !== it.type)
                                  );
                                  setSocialErrors((prev) => {
                                    const next = { ...prev };
                                    delete next[it.type];
                                    return next;
                                  });
                                }}
                                className="w-10 h-10 rounded-lg bg-white/5 border border-white/10 hover:border-white/30 grid place-items-center text-red-300 hover:text-red-200 transition"
                                aria-label="Удалить"
                                title="Удалить"
                              >
                                <Trash2 className="w-4 h-4" strokeWidth={1.7} />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="block text-sm text-white/60">Telegram уведомления</label>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 space-y-2">
                        {telegramLoading ? (
                          <p className="text-sm text-white/60">Загрузка статуса...</p>
                        ) : telegramStatus?.enabled === false ? (
                          <p className="text-sm text-white/60">
                            Бот не настроен на сервере. Укажите `TELEGRAM_BOT_TOKEN` в `.env`.
                          </p>
                        ) : telegramStatus?.connected ? (
                          <>
                            <p className="text-sm text-emerald-300">
                              Подключено
                              {telegramStatus.telegram_username
                                ? `: @${telegramStatus.telegram_username.replace(/^@+/, "")}`
                                : ""}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => void handleDisconnectTelegram()}
                                disabled={telegramActionLoading}
                                className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40 transition disabled:opacity-60"
                              >
                                {telegramActionLoading ? "Отключение..." : "Отключить"}
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-white/70">
                              Подключите Telegram, чтобы получать push о новых сообщениях в чатах.
                            </p>
                            <button
                              type="button"
                              onClick={() => void handleCreateTelegramCode()}
                              disabled={telegramActionLoading || telegramAwaitingConfirm}
                              className="rounded-full border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:border-white/40 transition disabled:opacity-60"
                            >
                              {telegramActionLoading
                                ? "Открываем Telegram..."
                                : telegramAwaitingConfirm
                                  ? "Ожидаем подтверждение..."
                                  : "Подключить Telegram"}
                            </button>
                            {telegramAwaitingConfirm && (
                              <p className="text-xs text-white/60">
                                Нажмите Start в Telegram. После возврата статус обновится автоматически.
                              </p>
                            )}
                          </>
                        )}

                        {telegramConnect?.start_code && telegramStatus?.connected !== true && (
                          <div className="rounded-lg border border-white/10 bg-black/30 p-2.5 space-y-2">
                            <p className="text-xs text-white/60">Код для бота (`/start код`):</p>
                            <div className="flex items-center gap-2">
                              <code className="flex-1 rounded bg-white/10 px-2 py-1 text-xs text-white break-all">
                                {telegramConnect.start_code}
                              </code>
                              <button
                                type="button"
                                onClick={() => void handleCopyTelegramCode()}
                                className="rounded-full border border-white/20 px-2.5 py-1 text-xs text-white/80 hover:border-white/40 transition"
                              >
                                {telegramCopyDone ? "Скопировано" : "Копировать"}
                              </button>
                            </div>
                            {telegramConnect.deep_link && (
                              <a
                                href={telegramConnect.deep_link}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center text-xs text-sky-200/90 hover:text-sky-100 underline underline-offset-2"
                              >
                                Открыть бота повторно
                              </a>
                            )}
                          </div>
                        )}
                        {telegramError && <p className="text-xs text-red-300">{telegramError}</p>}
                      </div>
                    </div>
                  </div>
                    </>
                  ) : (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm text-white/60 mb-1.5">Текущий пароль</label>
                        <input
                          type="password"
                          value={passwordForm.current_password}
                          onChange={(e) =>
                            setPasswordForm((prev) => ({ ...prev, current_password: e.target.value }))
                          }
                          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:border-white/40 outline-none"
                          placeholder="Введите текущий пароль"
                          autoComplete="current-password"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-white/60 mb-1.5">Новый пароль</label>
                        <input
                          type="password"
                          value={passwordForm.new_password}
                          onChange={(e) =>
                            setPasswordForm((prev) => ({ ...prev, new_password: e.target.value }))
                          }
                          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:border-white/40 outline-none"
                          placeholder="Минимум 8 символов"
                          autoComplete="new-password"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-white/60 mb-1.5">Подтвердите новый пароль</label>
                        <input
                          type="password"
                          value={passwordForm.confirm_password}
                          onChange={(e) =>
                            setPasswordForm((prev) => ({ ...prev, confirm_password: e.target.value }))
                          }
                          className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-white focus:border-white/40 outline-none"
                          placeholder="Повторите новый пароль"
                          autoComplete="new-password"
                        />
                      </div>
                      <p className="text-xs text-white/45">
                        После смены пароля войдите заново на других устройствах.
                      </p>
                    </div>
                  )}
                </div>

                {editSection === "profile" ? (
                  <div className="px-7 py-4 border-t border-white/10 bg-[#0b0b0f] shrink-0 space-y-3">
                    <ErrorMessage message={saveError} />
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs text-white/50">
                        {socialLinks.length >= 4 ? "Можно добавить не более 4 соцсетей" : ""}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (socialLinks.length >= 4 || availableSocialTypes.length === 0) return;
                            setSocialDraftType(availableSocialTypes[0]);
                            setSocialDraftUsername("");
                            setSocialDraftError("");
                            setSocialDraftOpen(true);
                          }}
                          disabled={socialLinks.length >= 4 || availableSocialTypes.length === 0}
                          className="rounded-full border border-white/20 px-3 py-2 text-sm text-white/80 hover:border-white/40 transition disabled:opacity-50"
                        >
                          Добавить соцсеть
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={
                            saving ||
                            avatarUpload.uploading ||
                            bgUpload.uploading ||
                            (!!pendingAvatar && !avatarUpload.uploadedUrl) ||
                            (!!pendingBackground && !bgUpload.uploadedUrl)
                          }
                          className="bg-white text-black rounded-full px-4 py-2 text-sm font-semibold hover:bg-white/90 disabled:opacity-60"
                        >
                          {saving ? "Сохранение..." : "Сохранить"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="px-7 py-4 border-t border-white/10 bg-[#0b0b0f] shrink-0 space-y-3">
                    <ErrorMessage message={passwordError} />
                    {passwordSuccess && <p className="text-sm text-emerald-300">{passwordSuccess}</p>}
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={closeEditModal}
                        className="rounded-full border border-white/20 px-3 py-2 text-sm text-white/80 hover:border-white/40 transition"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={handleChangePassword}
                        disabled={passwordSaving}
                        className="bg-white text-black rounded-full px-4 py-2 text-sm font-semibold hover:bg-white/90 disabled:opacity-60"
                      >
                        {passwordSaving ? "Сохранение..." : "Сменить пароль"}
                      </button>
                    </div>
                  </div>
                )}

                {editSection === "profile" && socialDraftOpen && (
                  <div
                    className="absolute inset-0 z-30 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onMouseDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      setSocialDraftOpen(false);
                      setSocialDraftError("");
                      setSocialDraftUsername("");
                    }}
                  >
                    <div
                      className="bg-[#0b0b0f] border border-white/10 rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-3"
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-white font-semibold">Добавить соцсеть</p>
                        <button
                          type="button"
                          className="text-white/60 hover:text-white"
                          onClick={() => {
                            setSocialDraftOpen(false);
                            setSocialDraftError("");
                            setSocialDraftUsername("");
                          }}
                          aria-label="Закрыть"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <select
                          value={socialDraftType}
                          onChange={(e) => {
                            setSocialDraftType(e.target.value as SocialType);
                            setSocialDraftError("");
                          }}
                          className="rounded-lg bg-black/40 border border-white/10 px-3 py-2.5 text-white/90 outline-none text-sm"
                        >
                          {(availableSocialTypes.includes(socialDraftType)
                            ? availableSocialTypes
                            : ([socialDraftType, ...availableSocialTypes] as SocialType[])
                          ).map((t) => (
                            <option key={t} value={t}>
                              {socialLabel[t]}
                            </option>
                          ))}
                        </select>
                        <input
                          value={socialDraftUsername}
                          onChange={(e) => {
                            setSocialDraftUsername(e.target.value);
                            setSocialDraftError("");
                          }}
                          className="flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2.5 text-white outline-none text-sm"
                          placeholder={socialPlaceholder[socialDraftType]}
                        />
                      </div>

                      {socialDraftError && (
                        <p className="text-xs text-red-300">{socialDraftError}</p>
                      )}

                      <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSocialDraftOpen(false);
                            setSocialDraftError("");
                            setSocialDraftUsername("");
                          }}
                          className="rounded-full border border-white/20 px-3 py-2 text-sm text-white/80 hover:border-white/40 transition"
                        >
                          Отмена
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const res = normalizeSocialUsername(
                              socialDraftType,
                              socialDraftUsername
                            );
                            if ("error" in res) {
                              setSocialDraftError(res.error);
                              return;
                            }
                            setSocialLinks((prev) => [
                              ...prev,
                              { type: socialDraftType, username: res.username },
                            ]);
                            setSocialDraftOpen(false);
                            setSocialDraftError("");
                            setSocialDraftUsername("");
                          }}
                          className="rounded-full bg-white text-black px-3 py-2 text-sm font-semibold hover:bg-white/90 transition"
                        >
                          Добавить
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      {drawingTarget && (
        <DrawingModal
          title={drawingTarget === "background" ? "Рисование фона" : "Рисование аватара"}
          canvasWidth={drawingTarget === "background" ? Math.max(600, Math.round(500 * bgCropRatio)) : 1024}
          canvasHeight={drawingTarget === "background" ? 500 : 1024}
          canvasContainerClassName={
            drawingTarget === "avatar" ? "mx-auto w-full max-w-[420px]" : "w-full"
          }
          canvasContainerStyle={{
            aspectRatio:
              drawingTarget === "background"
                ? `${Math.max(600, Math.round(500 * bgCropRatio))} / 500`
                : "1 / 1",
          }}
          canvasClassName="w-full h-full rounded-xl touch-none select-none"
          onClose={() => setDrawingTarget(null)}
          onSave={(file) => {
            const target = drawingTarget;
            setDrawingTarget(null);
            if (!target) return;
            applyPendingImage(target, file);
          }}
        />
      )}

      {cropTarget &&
        createPortal(
          <div
            className="fixed inset-0 z-[1500] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={closeCrop}
          >
            <div
              className="relative bg-black border border-white/10 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <FabricImageEditor
                variant="cropOnly"
                title={cropTarget.target === "avatar" ? "Кадрирование аватара" : "Кадрирование фона"}
                src={cropTarget.srcUrl}
                fileName={cropTarget.file.name}
                fixedCropRatio={cropTarget.target === "avatar" ? 1 : bgCropRatio}
                initialMode="crop"
                initialCropPreset="free"
                cropMask={cropTarget.target === "avatar" ? "circle" : null}
                onCancel={closeCrop}
                onSave={(nextFile) => {
                  const target = cropTarget.target;
                  closeCrop();
                  applyPendingImage(target, nextFile);
                }}
              />
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

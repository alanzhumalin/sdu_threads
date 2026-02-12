import { useAuthStore } from "../store/auth";
import type { MediaItem } from "../types/media";

type HttpMethod = "GET" | "POST" | "DELETE" | "PATCH";

const API_BASE = "/api";

type SocialLinks = Partial<
  Record<"instagram" | "telegram" | "github" | "linkedin", string>
>;

export type ChatParticipant = {
  id: string;
  username: string;
  full_name: string;
  avatar_url?: string;
};

export type ChatLastMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export type ChatPreview = {
  id: string;
  participant: ChatParticipant;
  last_message?: ChatLastMessage;
  last_message_at?: string;
  unread_count: number;
};

export type ChatMessage = {
  id: string;
  chat_id: string;
  sender_id: string;
  reply_to_id?: string;
  body: string;
  read_at?: string;
  created_at: string;
};

type ApiErrorShape =
  | { error: string }
  | { error: { code?: string; message?: string; retry_after_seconds?: number } }
  | { message?: string };

function normalizeBackendMessage(msg: string, status: number, code?: string) {
  const raw = (msg || "").trim();
  const lower = raw.toLowerCase();

  if (code === "INVALID_CREDENTIALS" || lower.includes("invalid credentials")) {
    return "Неверный логин или пароль";
  }

  if (status === 401 || code === "UNAUTHORIZED") {
    return "Сессия истекла. Войдите снова.";
  }

  if (status === 403 || code === "FORBIDDEN") {
    return "Недостаточно прав для этого действия.";
  }

  if (status === 429 || code === "RATE_LIMIT") {
    return "Слишком часто. Попробуйте позже.";
  }

  if (lower.includes("rules must be accepted")) {
    return "Нужно принять правила использования сайта";
  }

  if (lower.includes("email must be institutional")) {
    return "Email должен быть в формате *@sdu.edu.kz";
  }

  if (lower.includes("email already registered")) {
    return "Этот email уже зарегистрирован";
  }

  if (lower.includes("username already taken")) {
    return "Этот username уже занят";
  }

  if (lower.includes("password must be at least")) {
    return "Пароль должен быть минимум 8 символов";
  }

  if (
    lower.includes("sqlstate") ||
    lower.includes("invalid input syntax for type uuid") ||
    lower.includes("pq:")
  ) {
    return "Что-то пошло не так. Попробуйте позже.";
  }

  if (raw.startsWith("HTTP ") || raw === "") {
    if (status >= 500) return "Ошибка сервера. Попробуйте позже.";
    if (status === 404) return "Не найдено";
    if (status === 400) return "Некорректный запрос";
    return "Что-то пошло не так. Попробуйте позже.";
  }

  return raw;
}

function isAuthEndpoint(path: string) {
  // Prevent redirect-loop / full page reload on login/register failures.
  return path.startsWith("/auth/");
}

async function readError(
  res: Response
): Promise<{ message: string; code?: string; retryAfterSeconds?: number }> {
  const text = (await res.text()).trim();
  if (!text) return { message: `HTTP ${res.status}` };

  try {
    const data = JSON.parse(text) as ApiErrorShape;
    const anyData = data as any;
    if (typeof anyData?.error === "string") {
      return { message: anyData.error };
    }
    if (anyData?.error && typeof anyData.error === "object") {
      const code = typeof anyData.error.code === "string" ? anyData.error.code : undefined;
      const msg = typeof anyData.error.message === "string" ? anyData.error.message : undefined;
      const retryAfterSeconds =
        typeof anyData.error.retry_after_seconds === "number"
          ? anyData.error.retry_after_seconds
          : undefined;
      if (msg) return { message: msg, code, retryAfterSeconds };
    }
    if (typeof anyData?.message === "string" && anyData.message) {
      return { message: anyData.message };
    }
    return { message: text };
  } catch {
    return { message: text };
  }
}

async function request<T>(
  path: string,
  method: HttpMethod = "GET",
  body?: any,
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Нет соединения с сервером. Попробуйте позже.");
  }
  if (res.status === 401 && !isAuthEndpoint(path)) {
    const hadToken = !!token || !!useAuthStore.getState().token;
    try {
      useAuthStore.getState().setToken(null);
    } catch {
      // ignore
    }
    // Guest UX: don't force a redirect; pages/actions can show an auth-gate overlay/modal.
    throw new Error(hadToken ? "Сессия истекла. Войдите снова." : "Сначала авторизуйся");
  }
  if (!res.ok) {
    const { message, code, retryAfterSeconds } = await readError(res);
    const err: any = new Error(normalizeBackendMessage(message, res.status, code));
    if (code) err.code = code;
    err.status = res.status;
    if (typeof retryAfterSeconds === "number") err.retry_after_seconds = retryAfterSeconds;
    throw err;
  }
  return res.json();
}

async function requestWithHeaders<T>(
  path: string,
  method: HttpMethod = "GET",
  body?: any,
  token?: string | null
): Promise<{ data: T; headers: Headers }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Нет соединения с сервером. Попробуйте позже.");
  }
  if (res.status === 401 && !isAuthEndpoint(path)) {
    const hadToken = !!token || !!useAuthStore.getState().token;
    try {
      useAuthStore.getState().setToken(null);
    } catch {
      // ignore
    }
    throw new Error(hadToken ? "Сессия истекла. Войдите снова." : "Сначала авторизуйся");
  }
  if (!res.ok) {
    const { message, code, retryAfterSeconds } = await readError(res);
    const err: any = new Error(normalizeBackendMessage(message, res.status, code));
    if (code) err.code = code;
    err.status = res.status;
    if (typeof retryAfterSeconds === "number") err.retry_after_seconds = retryAfterSeconds;
    throw err;
  }
  const data = await res.json();
  return { data, headers: res.headers };
}

async function requestForm<T>(
  path: string,
  method: Extract<HttpMethod, "POST" | "PATCH">,
  form: FormData,
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: form,
    });
  } catch {
    throw new Error("Нет соединения с сервером. Попробуйте позже.");
  }
  if (res.status === 401 && !isAuthEndpoint(path)) {
    const hadToken = !!token || !!useAuthStore.getState().token;
    try {
      useAuthStore.getState().setToken(null);
    } catch {
      // ignore
    }
    throw new Error(hadToken ? "Сессия истекла. Войдите снова." : "Сначала авторизуйся");
  }
  if (!res.ok) {
    const { message, code, retryAfterSeconds } = await readError(res);
    const err: any = new Error(normalizeBackendMessage(message, res.status, code));
    if (code) err.code = code;
    if (typeof retryAfterSeconds === "number") err.retry_after_seconds = retryAfterSeconds;
    throw err;
  }
  return res.json();
}

const feedPageFn = (
  limit = 20,
  offset = 0,
  token?: string | null
) =>
  requestWithHeaders<
    {
      id: string;
      user_id: string;
      content: string;
      username: string;
      full_name: string;
      avatar_url?: string;
      created_at: string;
      media?: MediaItem[];
      like_count: number;
      liked_by_me: boolean;
      view_count: number;
      comment_count?: number;
      mentions?: string[];
      hashtags?: string[];
      is_subscribed?: boolean;
      is_me?: boolean;
    }[]
  >(`/posts?limit=${limit}&offset=${offset}`, "GET", undefined, token).then(({ data, headers }) => ({
    items: data,
    nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
  }));

const followingFeedPageFn = (limit = 20, offset = 0, token?: string | null) =>
  requestWithHeaders<
    {
      id: string;
      user_id: string;
      content: string;
      username: string;
      full_name: string;
      avatar_url?: string;
      created_at: string;
      media?: MediaItem[];
      like_count: number;
      liked_by_me: boolean;
      view_count: number;
      comment_count?: number;
      mentions?: string[];
      hashtags?: string[];
      is_subscribed?: boolean;
      is_me?: boolean;
    }[]
  >(`/feed/following?limit=${limit}&offset=${offset}`, "GET", undefined, token).then(({ data, headers }) => ({
    items: data,
    nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
  }));

export const api = {
  login: (login: string, password: string) =>
    request<{ token: string }>("/auth/login", "POST", { login, password }),
  register: (payload: {
    email: string;
    username: string;
    full_name: string;
    password: string;
    accepted_rules: boolean;
  }) => request<{ token: string }>("/auth/register", "POST", payload),
  profileMe: (token?: string | null) =>
    request<{
      id: string;
      username: string;
      full_name: string;
      bio: string;
      avatar_url?: string;
      background_url?: string;
      social_links?: SocialLinks;
      followers: number;
      following: number;
      created_at: string;
      is_me?: boolean;
      is_subscribed?: boolean;
    }>("/users/me", "GET", undefined, token),
  profileByUsername: (username: string, token?: string | null) =>
    request<{
      id: string;
      username: string;
      full_name: string;
      bio: string;
      avatar_url?: string;
      background_url?: string;
      social_links?: SocialLinks;
      followers: number;
      following: number;
      created_at: string;
      is_me?: boolean;
      is_subscribed?: boolean;
    }>(`/users/${encodeURIComponent(username)}`, "GET", undefined, token),
  updateProfile: (
    payload: {
      full_name?: string;
      bio?: string;
      avatar_url?: string;
      background_url?: string;
      social_links?: SocialLinks;
    },
    token: string
  ) =>
    request<{
      id: string;
      username: string;
      full_name: string;
      bio: string;
      avatar_url?: string;
      background_url?: string;
      social_links?: SocialLinks;
      followers: number;
      following: number;
      created_at: string;
      is_me?: boolean;
      is_subscribed?: boolean;
    }>("/users/me", "PATCH", payload, token),
  feedPage: feedPageFn,
  followingFeedPage: followingFeedPageFn,
  feed: (token?: string | null) => feedPageFn(20, 0, token).then((r) => r.items),
  userPosts: (userId: string, limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        user_id: string;
        content: string;
        username: string;
        full_name: string;
        avatar_url?: string;
        created_at: string;
        media?: MediaItem[];
        like_count: number;
      liked_by_me: boolean;
      view_count: number;
      comment_count?: number;
      mentions?: string[];
      hashtags?: string[];
      is_subscribed?: boolean;
      is_me?: boolean;
    }[]
    >(`/users/${userId}/posts?limit=${limit}&offset=${offset}`, "GET", undefined, token).then(({ data, headers }) => ({
      items: data,
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  followers: (userId: string, limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        username: string;
        full_name: string;
        avatar_url?: string;
      }[]
    >(
      `/users/${encodeURIComponent(userId)}/followers?limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => {
      const items = Array.isArray(data) ? data : [];
      return {
        items,
        nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
      };
    }),
  following: (userId: string, limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        username: string;
        full_name: string;
        avatar_url?: string;
      }[]
    >(
      `/users/${encodeURIComponent(userId)}/following?limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => {
      const items = Array.isArray(data) ? data : [];
      return {
        items,
        nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
      };
    }),
  likedPosts: (limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        user_id: string;
        content: string;
        username: string;
        full_name: string;
        avatar_url?: string;
        created_at: string;
        updated_at?: string;
        media?: MediaItem[];
        like_count: number;
        liked_by_me: boolean;
        view_count: number;
        comment_count?: number;
        mentions?: string[];
        hashtags?: string[];
        is_subscribed?: boolean;
        is_me?: boolean;
      }[]
    >(`/posts-liked?limit=${limit}&offset=${offset}`, "GET", undefined, token).then(({ data, headers }) => ({
      items: data,
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  createPost: (
    payload: { content: string; media?: MediaItem[]; media_url?: string; media_urls?: string[]; hashtags?: string[] },
    token: string
  ) =>
    request<{ status: string }>("/posts", "POST", payload, token),
  uploadMedia: async (files: File[], purpose: string, token: string) => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    const res = await requestForm<{ items: MediaItem[] }>(
      `/media/upload?purpose=${encodeURIComponent(purpose)}`,
      "POST",
      form,
      token
    );
    return Array.isArray(res.items)
      ? res.items.filter((i) => i && typeof i.url === "string" && i.url.trim() !== "")
      : [];
  },
  presignMedia: async (
    files: { content_type: string; size_bytes: number }[],
    purpose: string,
    token: string
  ): Promise<
    {
      upload_url: string;
      method?: string;
      headers?: Record<string, string>;
      key: string;
      url: string;
      expires_unix: number;
    }[]
  > => {
    const res = await request<{ items: any[] }>(
      `/media/presign?purpose=${encodeURIComponent(purpose)}`,
      "POST",
      { files },
      token
    );
    return Array.isArray(res?.items)
      ? res.items.filter((i) => i && typeof i.upload_url === "string" && typeof i.url === "string")
      : [];
  },
  deleteMedia: async (keys: string[], purpose: string, token: string) => {
    if (!Array.isArray(keys) || keys.length === 0) return;
    await request<{ deleted: number }>(
      `/media/delete?purpose=${encodeURIComponent(purpose)}`,
      "POST",
      { keys },
      token
    );
  },
  uploadPresignedPut: async (
    presigned: { upload_url: string; method?: string; headers?: Record<string, string> },
    file: File,
    signal?: AbortSignal
  ) => {
    const method = (presigned.method || "PUT").toUpperCase();
    const headers = presigned.headers || {};
    const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === "content-type");

    // For Signature V2 presigned PUT URLs, Content-Type is part of the signature string.
    // If we don't have a signed Content-Type header, ensure the browser doesn't auto-add it.
    const body = hasContentType ? file : file.slice(0, file.size, "");

    const init: RequestInit = {
      method,
      body,
      credentials: "omit",
    };
    if (signal) init.signal = signal;
    if (Object.keys(headers).length > 0) init.headers = headers;

    const resp = await fetch(presigned.upload_url, init);

    if (!resp.ok) {
      throw new Error(`upload_failed_${resp.status}`);
    }
  },
  searchHashtags: (q: string, limit = 8) =>
    request<any[]>(
      `/hashtags/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      "GET"
    ).then((res) =>
      Array.isArray(res)
        ? res.map((h) => ({
            id: h.id ?? h.ID ?? h.Id,
            name: h.name ?? h.Name,
          }))
        : []
    ),
  popularHashtags: (limit = 10) =>
    request<any[]>(`/hashtags/popular?limit=${limit}`, "GET").then((res) =>
      Array.isArray(res)
        ? res.map((h) => ({
            id: h.id ?? h.ID ?? h.Id,
            name: h.name ?? h.Name,
            post_count: h.post_count ?? h.PostCount ?? h.postCount ?? 0,
          }))
        : []
    ),
  topUsers: (limit = 3, token?: string | null) =>
    request<
      {
        id: string;
        username: string;
        full_name: string;
        avatar_url?: string;
        followers: number;
      }[]
    >(`/top-users?limit=${limit}`, "GET", undefined, token || undefined),
  postsByHashtag: (name: string, limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        user_id: string;
        content: string;
        username: string;
        full_name: string;
        avatar_url?: string;
        created_at: string;
        updated_at: string;
        media?: MediaItem[];
        like_count: number;
        liked_by_me: boolean;
        view_count: number;
        comment_count?: number;
        mentions?: string[];
        hashtags?: string[];
        is_subscribed?: boolean;
        is_me?: boolean;
      }[]
    >(`/hashtags/${encodeURIComponent(name)}?limit=${limit}&offset=${offset}`, "GET", undefined, token).then(
      ({ data, headers }) => ({
        items: data,
        nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
      })
    ),
  openDirectChat: (payload: { user_id?: string; username?: string }, token: string) =>
    request<ChatPreview>("/chats/direct", "POST", payload, token),
  chats: (limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<ChatPreview[]>(
      `/chats?limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => ({
      items: Array.isArray(data) ? data : [],
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  chatById: (chatId: string, token?: string | null) =>
    request<ChatPreview>(`/chats/${encodeURIComponent(chatId)}`, "GET", undefined, token),
  chatMessages: (chatId: string, limit = 30, offset = 0, token?: string | null) =>
    requestWithHeaders<ChatMessage[]>(
      `/chats/${encodeURIComponent(chatId)}/messages?limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => ({
      items: Array.isArray(data) ? data : [],
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  sendChatMessage: (chatId: string, body: string, token: string, replyToID?: string) =>
    request<ChatMessage>(
      `/chats/${encodeURIComponent(chatId)}/messages`,
      "POST",
      { body, reply_to_id: replyToID },
      token
    ),
  markChatRead: (chatId: string, token?: string | null) =>
    request<{ status: string; updated: number }>(
      `/chats/${encodeURIComponent(chatId)}/read`,
      "POST",
      undefined,
      token
    ),
  chatsUnread: (token?: string | null) =>
    request<{ unread_count: number }>(`/chats-unread`, "GET", undefined, token),
  notificationsUnread: (token?: string | null) =>
    request<{ unread_count: number }>(`/notifications-unread`, "GET", undefined, token),
  notifications: (filter: "all" | "mentions" = "all", limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        type: string;
        actor_id: string;
        actor_username: string;
        actor_full_name?: string;
        actor_avatar_url?: string;
        post_id?: string;
        comment_id?: string;
        post_content?: string;
        post_media_url?: string;
        comment_body?: string;
        created_at: string;
        message?: string;
        read?: boolean;
      }[]
    >(
      `/notifications?filter=${filter}&limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => ({
      items: data,
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  markNotificationRead: (id: string, token?: string | null) =>
    request<{ status: string }>(`/notifications/${id}/read`, "POST", undefined, token),
  markAllNotificationsRead: (token?: string | null) =>
    request<{ status: string; updated?: number }>(`/notifications-read-all`, "POST", undefined, token),
  searchUsersPaged: (q: string, limit = 10, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        username: string;
        full_name: string;
        avatar_url?: string;
        bio?: string;
      }[]
    >(`/users/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`, "GET", undefined, token).then(
      ({ data, headers }) => ({
        items: data,
        nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
      })
    ),
  postById: (postId: string, token?: string | null) =>
    request<{
      id: string;
      user_id: string;
      username: string;
      full_name: string;
      avatar_url?: string;
      content: string;
      media?: MediaItem[];
      created_at: string;
      updated_at: string;
      like_count: number;
      liked_by_me: boolean;
      view_count: number;
      comment_count?: number;
      mentions?: string[];
      hashtags?: string[];
      is_subscribed?: boolean;
      is_me?: boolean;
    }>(`/posts/${postId}`, "GET", undefined, token),
  searchUsers: (q: string, limit = 20, offset = 0, token?: string | null) =>
    request<
      {
        id: string;
        username: string;
        full_name?: string;
        bio?: string;
        avatar_url?: string;
      }[]
    >(`/users/search?q=${encodeURIComponent(q)}&limit=${limit}&offset=${offset}`, "GET", undefined, token),
  likePost: (postId: string, token: string) =>
    request<{ status: string }>(`/posts/${postId}/like`, "POST", undefined, token),
  unlikePost: (postId: string, token: string) =>
    request<{ status: string }>(`/posts/${postId}/like`, "DELETE", undefined, token),
  viewPost: (postId: string, token: string) =>
    request<{ status: string }>(`/posts/${postId}/view`, "POST", undefined, token),
  listComments: (postId: string, limit = 20, offset = 0, token?: string | null) =>
    request<
      {
        id: string;
        post_id: string;
        user_id: string;
      username: string;
      full_name?: string;
      avatar_url?: string;
      body: string;
      created_at: string;
      liked_by_me: boolean;
      like_count: number;
      replies_count: number;
      reply_to_comment_id?: string;
      replies?: any[];
      reply_to_full_name?: string;
      reply_to_username?: string;
      mentions?: string[];
      hashtags?: string[];
    }[]
  >(`/comments?post_id=${postId}&limit=${limit}&offset=${offset}`, "GET", undefined, token),
  listReplies: (commentId: string, limit = 20, offset = 0, token?: string | null) =>
    request<
      {
        id: string;
        post_id: string;
        user_id: string;
      username: string;
      full_name?: string;
      avatar_url?: string;
      body: string;
      created_at: string;
      liked_by_me: boolean;
      like_count: number;
      replies_count: number;
      reply_to_comment_id?: string;
      replies?: any[];
      mentions?: string[];
      hashtags?: string[];
    }[]
  >(`/comments/${commentId}/replies?limit=${limit}&offset=${offset}`, "GET", undefined, token),
  createComment: (postId: string, body: string, replyTo?: string, hashtags?: string[], token?: string | null) =>
    request<{ status: string }>(
      `/comments`,
      "POST",
      replyTo
        ? { post_id: postId, content: body, reply_to_comment_id: replyTo, hashtags }
        : { post_id: postId, content: body, hashtags },
      token || undefined
    ),
  likeComment: (commentId: string, token: string) =>
    request<{ status: string }>(`/comments/${commentId}/like`, "POST", undefined, token),
  unlikeComment: (commentId: string, token: string) =>
    request<{ status: string }>(`/comments/${commentId}/like`, "DELETE", undefined, token),
  followUser: (userId: string, token: string) =>
    request<{ status: string }>(`/users/${userId}/follow`, "POST", undefined, token),
  unfollowUser: (userId: string, token: string) =>
    request<{ status: string }>(`/users/${userId}/follow`, "DELETE", undefined, token),
  createReport: (
    payload: { target_type: "post" | "user"; target_id: string; reason: string; details?: string },
    token?: string | null
  ) => request<{ status: string; id?: string }>(`/reports`, "POST", payload, token),

  adminStats: (token?: string | null) =>
    request<{
      users_count: number;
      posts_count: number;
      active_users_15m: number;
      generated_at?: string;
    }>(`/admin/stats`, "GET", undefined, token),
  adminMe: (token?: string | null) =>
    request<{ role: string; is_root_admin: boolean }>(`/admin/me`, "GET", undefined, token),
  adminUsers: (query = "", limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        username: string;
        full_name: string;
        avatar_url?: string;
        role: string;
        created_at: string;
      }[]
    >(
      `/admin/users?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => ({
      items: Array.isArray(data) ? data : [],
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  adminUser: (idOrUsername: string, token?: string | null) =>
    request<{ profile: any; role: string }>(
      `/admin/users/${encodeURIComponent(idOrUsername)}`,
      "GET",
      undefined,
      token
    ),
  adminUserPosts: (idOrUsername: string, limit = 20, offset = 0, query = "", token?: string | null) =>
    requestWithHeaders<any[]>(
      `/admin/users/${encodeURIComponent(idOrUsername)}/posts?query=${encodeURIComponent(
        query
      )}&limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => ({
      items: Array.isArray(data) ? data : [],
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  adminSetUserRole: (idOrUsername: string, role: "user" | "moderator" | "admin", token: string) =>
    request<{ status: string }>(
      `/admin/users/${encodeURIComponent(idOrUsername)}/role`,
      "PATCH",
      { role },
      token
    ),
  adminDeleteUser: (idOrUsername: string, token: string) =>
    request<{ status: string }>(
      `/admin/users/${encodeURIComponent(idOrUsername)}`,
      "DELETE",
      undefined,
      token
    ),
  adminRemovePost: (postId: string, reason: string | undefined, token: string) =>
    request<{ status: string }>(
      `/admin/posts/${encodeURIComponent(postId)}/remove`,
      "POST",
      { reason },
      token
    ),

  moderationPosts: (query = "", limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<any[]>(
      `/moderation/posts?query=${encodeURIComponent(query)}&limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => ({
      items: Array.isArray(data) ? data : [],
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  moderationRemovePost: (postId: string, reason: string | undefined, token: string) =>
    request<{ status: string }>(
      `/moderation/posts/${encodeURIComponent(postId)}/remove`,
      "POST",
      { reason },
      token
    ),

  moderationReports: (
    status: "open" | "resolved" | "rejected",
    query = "",
    limit = 20,
    offset = 0,
    token?: string | null
  ) =>
    requestWithHeaders<any[]>(
      `/moderation/reports?status=${encodeURIComponent(status)}&query=${encodeURIComponent(
        query
      )}&limit=${limit}&offset=${offset}`,
      "GET",
      undefined,
      token
    ).then(({ data, headers }) => ({
      items: Array.isArray(data) ? data : [],
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  moderationReport: (id: string, token?: string | null) =>
    request<any>(`/moderation/reports/${encodeURIComponent(id)}`, "GET", undefined, token),
  moderationResolveReport: (
    id: string,
    status: "resolved" | "rejected",
    note: string | undefined,
    token: string
  ) =>
    request<{ status: string }>(
      `/moderation/reports/${encodeURIComponent(id)}/resolve`,
      "POST",
      { status, note },
      token
    ),
};

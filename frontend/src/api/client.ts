import { useAuthStore } from "../store/auth";

type HttpMethod = "GET" | "POST" | "DELETE" | "PATCH";

const API_BASE = "/api";

let redirecting = false;

type SocialLinks = Partial<
  Record<"instagram" | "telegram" | "github" | "linkedin", string>
>;

type ApiErrorShape =
  | { error: string }
  | { error: { code?: string; message?: string; retry_after_seconds?: number } }
  | { message?: string };

function normalizeBackendMessage(msg: string, status: number, code?: string) {
  const raw = (msg || "").trim();
  const lower = raw.toLowerCase();

  if (status === 401 || status === 403 || code === "UNAUTHORIZED") {
    return "Сессия истекла. Войдите снова.";
  }

  if (status === 429 || code === "RATE_LIMIT") {
    return "Слишком часто. Попробуйте позже.";
  }

  if (code === "INVALID_CREDENTIALS" || lower.includes("invalid credentials")) {
    return "Неверный логин или пароль";
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
  if (res.status === 401 || res.status === 403) {
    if (!redirecting) {
      redirecting = true;
      try {
        useAuthStore.getState().setToken(null);
      } catch {
        // ignore
      }
      window.location.href = "/login";
    }
    throw new Error("Сессия истекла. Войдите снова.");
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
  if (res.status === 401 || res.status === 403) {
    if (!redirecting) {
      redirecting = true;
      try {
        useAuthStore.getState().setToken(null);
      } catch {
        // ignore
      }
      window.location.href = "/login";
    }
    throw new Error("Сессия истекла. Войдите снова.");
  }
  if (!res.ok) {
    const { message, code, retryAfterSeconds } = await readError(res);
    const err: any = new Error(normalizeBackendMessage(message, res.status, code));
    if (code) err.code = code;
    if (typeof retryAfterSeconds === "number") err.retry_after_seconds = retryAfterSeconds;
    throw err;
  }
  const data = await res.json();
  return { data, headers: res.headers };
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
      created_at: string;
      media_url?: string;
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
      created_at: string;
      media_url?: string;
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
        created_at: string;
        media_url?: string;
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
    ).then(({ data, headers }) => ({
      items: data,
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
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
    ).then(({ data, headers }) => ({
      items: data,
      nextOffset: headers.get("x-next-offset") ? Number(headers.get("x-next-offset")) : null,
    })),
  likedPosts: (limit = 20, offset = 0, token?: string | null) =>
    requestWithHeaders<
      {
        id: string;
        user_id: string;
        content: string;
        username: string;
        full_name: string;
        created_at: string;
        updated_at?: string;
        media_url?: string;
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
  createPost: (payload: { content: string; media_url?: string; hashtags?: string[] }, token: string) =>
    request<{ status: string }>("/posts", "POST", payload, token),
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
        created_at: string;
        updated_at: string;
        media_url?: string;
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
      content: string;
      media_url?: string;
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
};

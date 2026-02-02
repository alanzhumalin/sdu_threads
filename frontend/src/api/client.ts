type HttpMethod = "GET" | "POST" | "DELETE";

const API_BASE = "/api";

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
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string }>("/auth/login", "POST", { email, password }),
  register: (payload: {
    email: string;
    username: string;
    full_name: string;
    password: string;
  }) => request<{ token: string }>("/auth/register", "POST", payload),
  feed: (token?: string | null) =>
    request<
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
      }[]
    >("/posts?limit=20", "GET", undefined, token),
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
        body: string;
        created_at: string;
        liked_by_me: boolean;
        like_count: number;
        replies_count: number;
        reply_to_comment_id?: string;
        replies?: any[];
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
      }[]
    >(`/comments/${commentId}/replies?limit=${limit}&offset=${offset}`, "GET", undefined, token),
  createComment: (postId: string, body: string, replyTo?: string, token?: string | null) =>
    request<{ status: string }>(
      `/comments`,
      "POST",
      replyTo ? { post_id: postId, content: body, reply_to_comment_id: replyTo } : { post_id: postId, content: body },
      token || undefined
    ),
  likeComment: (commentId: string, token: string) =>
    request<{ status: string }>(`/comments/${commentId}/like`, "POST", undefined, token),
  unlikeComment: (commentId: string, token: string) =>
    request<{ status: string }>(`/comments/${commentId}/like`, "DELETE", undefined, token),
};

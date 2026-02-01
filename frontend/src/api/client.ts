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
        id: number;
        user_id: number;
        content: string;
        username: string;
        full_name: string;
        created_at: string;
        like_count: number;
        liked_by_me: boolean;
      }[]
    >("/posts?limit=20", "GET", undefined, token),
  createPost: (payload: { content: string; media_url?: string; hashtags?: string[] }, token: string) =>
    request<{ status: string }>("/posts", "POST", payload, token),
  likePost: (postId: number, token: string) =>
    request<{ status: string }>(`/posts/${postId}/like`, "POST", undefined, token),
  unlikePost: (postId: number, token: string) =>
    request<{ status: string }>(`/posts/${postId}/like`, "DELETE", undefined, token),
};

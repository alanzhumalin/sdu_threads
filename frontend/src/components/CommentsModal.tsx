import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { X, Heart, Paperclip, SendHorizontal, MessageCircle, Eye } from "lucide-react";
import { highlightHashtags } from "../utils/text";

type Comment = {
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
};

type PostMeta = {
  id: string;
  user_id: string;
  username: string;
  full_name: string;
  content: string;
  created_at: string;
  media_url?: string;
  like_count: number;
  liked_by_me: boolean;
  view_count: number;
  comment_count?: number;
};

type Props = {
  post: PostMeta;
  onClose: () => void;
  onUpdatePost?: (id: string, patch: Partial<PostMeta>) => void;
};

const PAGE = 20;

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

export function CommentsModal({ post, onClose, onUpdatePost }: Props) {
  const token = useAuthStore((s) => s.token);
  const [postMeta, setPostMeta] = useState(post);
  const [comments, setComments] = useState<Comment[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [replies, setReplies] = useState<
    Record<string, { items: Comment[]; offset: number; total: number | null; loading: boolean }>
  >({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const load = async (append = false) => {
    if (loading) return;
    setLoading(true);
    try {
      const data = await api.listComments(post.id, PAGE, append ? offset : 0, token);
      setTotal((t) => (t === null ? data.length : t)); // rough total; server не отдаёт total
      setComments((prev) => (append ? [...prev, ...data] : data));
      if (append) setOffset((o) => o + data.length);
      else setOffset(data.length);
      setError("");
    } catch (e: any) {
      setError(e.message || "Не удалось загрузить комментарии");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post.id]);

  useEffect(() => {
    setPostMeta(post);
  }, [post]);

  const loadReplies = async (commentId: string) => {
    setReplies((prev) => ({
      ...prev,
      [commentId]: { ...(prev[commentId] || { items: [], offset: 0, total: null }), loading: true },
    }));
    const state = replies[commentId] || { items: [], offset: 0, total: null };
    try {
      const data = await api.listReplies(commentId, PAGE, state.offset, token);
      const nextOffset = state.offset + data.length;
      const total = state.total ?? (data.length < PAGE ? nextOffset : null);
      setReplies((prev) => ({
        ...prev,
        [commentId]: {
          items: [...state.items, ...data],
          offset: nextOffset,
          total,
          loading: false,
        },
      }));
    } catch {
      setReplies((prev) => ({
        ...prev,
        [commentId]: { ...(prev[commentId] || state), loading: false },
      }));
    }
  };

  const send = async () => {
    if (!body.trim() || !token) return;
    try {
      await api.createComment(post.id, body.trim(), replyTo?.id, token);
      setBody("");
      setReplyTo(null);
      load(false);
    } catch (e: any) {
      setError(e.message || "Не удалось отправить комментарий");
    }
  };

  const toggleLike = async (c: Comment) => {
    if (!token) return;
    setComments((prev) =>
      prev.map((x) =>
        x.id === c.id
          ? {
              ...x,
              liked_by_me: !x.liked_by_me,
              like_count: x.like_count + (x.liked_by_me ? -1 : 1),
            }
          : x
      )
    );
    try {
      if (c.liked_by_me) await api.unlikeComment(c.id, token);
      else await api.likeComment(c.id, token);
    } catch {
      // ignore
    }
  };

  const remaining = total !== null ? Math.max(total - comments.length, 0) : null;
  const moreLabel = remaining !== null ? Math.min(remaining, PAGE) : PAGE;

  const adjustTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    const styles = window.getComputedStyle(el);
    const lineHeight = parseInt(styles.lineHeight, 10) || 20;
    const minHeight = lineHeight * 2;
    const maxHeight = lineHeight * 4;
    el.style.height = "auto";
    const next = Math.min(Math.max(el.scrollHeight, minHeight), maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  useEffect(() => {
    adjustTextarea();
  }, [body]);

  const togglePostLike = () => {
    if (!token) return;
    setPostMeta((prev) => {
      const nextLiked = !prev.liked_by_me;
      const patch = {
        liked_by_me: nextLiked,
        like_count: prev.like_count + (nextLiked ? 1 : -1),
      };
      const previous = prev;

      onUpdatePost?.(prev.id, patch);

      (async () => {
        try {
          if (nextLiked) await api.likePost(prev.id, token);
          else await api.unlikePost(prev.id, token);
        } catch {
          setPostMeta(previous);
          onUpdatePost?.(prev.id, { liked_by_me: previous.liked_by_me, like_count: previous.like_count });
        }
      })();

      return { ...prev, ...patch };
    });
  };

  const focusTextarea = () => {
    textareaRef.current?.focus();
  };

  return createPortal(
    <div className="fixed inset-0 w-screen h-screen z-[120] flex items-center justify-center bg-black/70 backdrop-blur-lg">
      <div ref={containerRef} className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl bg-black border border-white/10 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <span className="text-white font-semibold">Комментарии</span>
          <button onClick={onClose} className="text-white/60 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-4 pt-4 pb-2 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold">
              {post.full_name?.[0]?.toUpperCase() || post.username[0].toUpperCase()}
            </div>
            <div>
              <p className="text-white font-semibold">{post.full_name || post.username}</p>
              <p className="text-white/60 text-sm">{timeAgo(post.created_at)}</p>
            </div>
          </div>
          <p className="mt-3 text-white leading-relaxed break-words">{highlightHashtags(post.content)}</p>
          {post.media_url && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
              <img src={post.media_url} alt="media" className="w-full h-auto object-cover" />
            </div>
          )}
          <div className="mt-3 flex items-center gap-4 text-sm text-white/70">
            <button
              className={`flex items-center gap-2 rounded-full px-2 py-1 transition ${postMeta.liked_by_me ? "text-red-300" : "hover:text-white"}`}
              onClick={togglePostLike}
              type="button"
            >
              <Heart className={`w-6 h-6 ${postMeta.liked_by_me ? "fill-current" : ""}`} strokeWidth={1.8} />
              <span>{postMeta.like_count}</span>
            </button>
            <button
              className="flex items-center gap-2 rounded-full px-2 py-1 hover:text-white transition"
              onClick={focusTextarea}
              type="button"
            >
              <MessageCircle className="w-6 h-6" strokeWidth={1.8} />
              <span>{postMeta.comment_count ?? 0}</span>
            </button>
            <div className="flex items-center gap-2 ml-auto">
              <Eye className="w-6 h-6" strokeWidth={1.6} />
              <span>{postMeta.view_count}</span>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="border border-white/10 rounded-xl p-3 flex gap-3">
              <div className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-sm font-semibold text-white">
                {c.username?.[0]?.toUpperCase() || "?"}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between text-sm text-white/70">
                  <span className="font-semibold text-white">{c.username}</span>
                  <span>{timeAgo(c.created_at)}</span>
                </div>
                {c.reply_to_comment_id && (
                  <div className="text-xs text-white/50 mt-1">в ответ на коммент</div>
                )}
                <div className="mt-2 text-white leading-relaxed break-words">{highlightHashtags(c.body)}</div>
                <div className="mt-3 flex items-center justify-between text-sm text-white/60">
                  <div className="flex items-center gap-3">
                    <button
                      className={`flex items-center gap-1 ${c.liked_by_me ? "text-red-400" : "text-white/70 hover:text-white"}`}
                      onClick={() => toggleLike(c)}
                    >
                      <Heart className={`w-4 h-4 ${c.liked_by_me ? "fill-current" : ""}`} strokeWidth={1.6} />
                      <span>{c.like_count}</span>
                    </button>
                    <button
                      className="text-white/70 hover:text-white"
                      onClick={() => {
                        setReplyTo(c);
                        setBody((b) => (b.startsWith(`@${c.username} `) ? b : `@${c.username} ` + b));
                      }}
                    >
                      Ответить
                    </button>
                    {c.replies_count > 0 && (
                      <button
                        className="text-white/70 hover:text-white"
                        onClick={() => loadReplies(c.id)}
                        disabled={replies[c.id]?.loading}
                      >
                        Показать ответы ({c.replies_count})
                      </button>
                    )}
                  </div>
                </div>
                {replies[c.id]?.items?.length ? (
                  <div className="mt-3 space-y-2 pl-2 border-l border-white/10">
                    {replies[c.id].items.map((r) => (
                      <div key={r.id} className="flex gap-2 items-start text-sm text-white/80">
                        <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs font-semibold text-white">
                          {r.username?.[0]?.toUpperCase() || "?"}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 text-xs text-white/60">
                            <span className="font-semibold text-white">{r.username}</span>
                            <span>{new Date(r.created_at).toLocaleString()}</span>
                          </div>
                          <div className="leading-relaxed">{highlightHashtags(r.body)}</div>
                        </div>
                      </div>
                    ))}
                    {replies[c.id].total === null && (
                      <button
                        className="text-white/60 hover:text-white text-xs"
                        onClick={() => loadReplies(c.id)}
                        disabled={replies[c.id].loading}
                      >
                        Показать ещё ответы
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {comments.length === 0 && !loading && <p className="text-white/60">Комментариев нет</p>}
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {remaining !== null && remaining > 0 && (
            <button
              onClick={() => load(true)}
              className="w-full rounded-full border border-white/10 text-white py-2 hover:bg-white/5"
              disabled={loading}
            >
              Показать ещё {moreLabel} комментариев{total ? ` (всего ${total})` : ""}
            </button>
          )}
        </div>

        <div className="border-t border-white/10 p-3 flex items-center gap-3">
          <button className="nav-icon bg-white/5 border border-white/10 text-white/80 hover:text-white" type="button" aria-label="attach" disabled>
            <Paperclip className="w-5 h-5" />
          </button>
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-white placeholder:text-white/40 focus:border-white/30 outline-none transition resize-none"
              rows={2}
              placeholder={replyTo ? `Ответить ${replyTo.username}` : "Написать комментарий..."}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onInput={adjustTextarea}
            />
          </div>
          <button
            onClick={send}
            disabled={!body.trim() || !token}
            className={`nav-icon ${body.trim() && token ? "bg-sky-500 text-black" : "bg-white/10 text-white/60"}`}
            aria-label="send"
          >
            <SendHorizontal className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuthStore } from "../store/auth";
import { CommentsModal, PostMeta } from "../components/CommentsModal";
import { useFeedStore } from "../store/feed";
import { ErrorMessage } from "../components/ErrorMessage";
import { useSubscriptionsStore } from "../store/subscriptions";

export default function PostPermalinkPage() {
  const token = useAuthStore((s) => s.token);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const updateFeedItem = useFeedStore((s) => s.updateItem);
  const setFollow = useSubscriptionsStore((s) => s.setFollow);

  const [post, setPost] = useState<PostMeta | null>(null);
  const authorSubscribed = useSubscriptionsStore((s) => {
    const uid = post?.user_id;
    if (!uid) return undefined;
    return s.byUserId[uid];
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!post) return;
    if (post.is_me) return;
    if (typeof authorSubscribed !== "boolean") return;
    if (post.is_subscribed === authorSubscribed) return;
    setPost((prev) => (prev ? { ...prev, is_subscribed: authorSubscribed } : prev));
  }, [authorSubscribed, post?.id, post?.is_me, post?.is_subscribed]);

  useEffect(() => {
    if (!id) {
      setError("Некорректная ссылка на пост");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");

    api
      .postById(id, token)
      .then((p) => {
        if (cancelled) return;
        const storeSub = useSubscriptionsStore.getState().byUserId[p.user_id];
        const effectiveSub = typeof storeSub === "boolean" ? storeSub : p.is_subscribed;
        const meta: PostMeta = {
          id: p.id,
          user_id: p.user_id,
          username: p.username,
          full_name: p.full_name,
          content: p.content,
          created_at: p.created_at,
          media_url: p.media_url,
          like_count: p.like_count,
          liked_by_me: p.liked_by_me,
          view_count: p.view_count,
          comment_count: p.comment_count,
          mentions: p.mentions,
          hashtags: p.hashtags,
          is_subscribed: effectiveSub,
          is_me: p.is_me,
        };
        if (typeof meta.is_subscribed === "boolean") {
          setFollow(meta.user_id, meta.is_subscribed);
        }
        setPost(meta);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message || "Не удалось загрузить пост");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, token]);

  return (
    <main data-page-root className="max-w-[672px] w-full mx-auto py-6 space-y-4 page-fade">
      {loading && <p className="text-white/60">Загрузка поста...</p>}
      {error && (
        <div className="card p-4 space-y-3">
          <ErrorMessage message={error} />
          <button
            type="button"
            onClick={() => navigate("/", { replace: true })}
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-white/80 hover:bg-white/5"
          >
            На главную
          </button>
        </div>
      )}

      {post && (
        <CommentsModal
          post={post}
          onUpdatePost={(postId, patch) => {
            setPost((prev) => (prev?.id === postId ? { ...prev, ...patch } : prev));
            updateFeedItem(postId, patch as any);
          }}
          onClose={() => navigate("/", { replace: true })}
        />
      )}
    </main>
  );
}

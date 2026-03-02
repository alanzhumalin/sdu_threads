import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { QuotedPostPreview } from "../api/client";
import { MentionPreview } from "./MentionPreview";
import { VerifiedBadge } from "./VerifiedBadge";
import { PostMedia } from "./PostMedia";
import { formatTimeAgo } from "../utils/time";
import { useI18n } from "../i18n";

type Props = {
  post?: QuotedPostPreview | null;
  className?: string;
  onRemove?: () => void;
  clickable?: boolean;
};

export function QuotedPostCard({ post, className = "", onRemove, clickable = true }: Props) {
  const { language, t } = useI18n();
  if (!post) return null;

  return (
    <div className={`relative mt-3 rounded-2xl border border-white/15 bg-black/25 p-3 ${className}`}>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="absolute right-2 top-2 z-10 h-7 w-7 rounded-full border border-white/15 bg-black/55 text-white/80 hover:text-white hover:bg-black/75 grid place-items-center"
          aria-label="remove quote"
        >
          <X className="h-4 w-4" />
        </button>
      ) : null}

      <div className="flex items-center gap-2.5 pr-8">
        <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-xs font-semibold text-white">
          <span aria-hidden>{post.full_name?.[0]?.toUpperCase() || post.username?.[0]?.toUpperCase() || "U"}</span>
          {post.avatar_url ? (
            <img src={post.avatar_url} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
          ) : null}
        </span>
        <div className="min-w-0">
          <MentionPreview username={post.username}>
            <Link to={`/u/${post.username}`} className="inline-flex min-w-0 items-center gap-[3px] text-sm font-semibold text-white hover:underline">
              <span className="truncate">{post.full_name || post.username}</span>
              {post.is_verified ? <VerifiedBadge /> : null}
            </Link>
          </MentionPreview>
          <p className="truncate text-xs text-white/60">
            @{post.username}
            <span className="mx-1">·</span>
            {formatTimeAgo(post.created_at, language)}
          </p>
        </div>
      </div>

      {post.content ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-white/90">
          {post.content}
        </p>
      ) : null}

      {Array.isArray(post.media) && post.media.length > 0 ? (
        <div className={post.content ? "mt-2" : "mt-3"}>
          <PostMedia media={post.media} autoPlayWhenHalfVisible={clickable} />
        </div>
      ) : null}

      {clickable ? (
        <Link
          to={`/p/${post.id}`}
          className="mt-2 inline-flex text-xs font-medium text-sky-200 hover:text-sky-100"
        >
          {t("post.quote.open_original")}
        </Link>
      ) : null}
    </div>
  );
}

import { CommentSkeleton } from "./CommentSkeleton";
import { PostSkeleton } from "./PostSkeleton";

export function PostPermalinkSkeleton() {
  return (
    <main className="max-w-[672px] w-full mx-auto py-6 space-y-4">
      <PostSkeleton withMedia />
      <div className="card p-4 space-y-3">
        <div className="h-4 w-40 bg-white/10 rounded animate-pulse" />
        <div className="space-y-3">
          <CommentSkeleton />
          <CommentSkeleton />
          <CommentSkeleton />
        </div>
      </div>
    </main>
  );
}


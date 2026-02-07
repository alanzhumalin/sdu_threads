import { PostSkeleton } from "./PostSkeleton";

export function ProfileSkeleton() {
  return (
    <div className="space-y-6">
      <div className="card overflow-hidden bg-black shadow-xl">
        <div className="relative h-40 md:h-52 overflow-hidden">
          <div className="absolute inset-0 bg-white/5 animate-pulse" />
        </div>

        <div className="px-4 pb-5 pt-6 md:pt-8 flex flex-col md:flex-row md:items-start md:justify-between gap-4 relative">
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="w-24 h-24 rounded-full bg-white/10 border border-white/10 overflow-hidden absolute -top-14 animate-pulse" />
              <div className="mt-12 space-y-2">
                <div className="h-6 w-44 rounded-full bg-white/10 animate-pulse" />
                <div className="h-4 w-28 rounded-full bg-white/5 animate-pulse" />
                <div className="h-4 w-60 rounded-full bg-white/5 animate-pulse" />
                <div className="h-4 w-36 rounded-full bg-white/5 animate-pulse" />
                <div className="flex items-center gap-5 pt-1">
                  <div className="h-4 w-28 rounded-full bg-white/5 animate-pulse" />
                  <div className="h-4 w-28 rounded-full bg-white/5 animate-pulse" />
                </div>
              </div>
            </div>
          </div>

          <div className="md:pt-0 pt-2 flex md:justify-end">
            <div className="h-10 w-32 rounded-full bg-white/10 border border-white/10 animate-pulse" />
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/60 backdrop-blur p-4 shadow-xl space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-24 rounded-full bg-white/10 animate-pulse" />
          <div className="h-10 w-40 rounded-full bg-white/5 animate-pulse" />
        </div>

        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <PostSkeleton key={n} withMedia={n === 1} />
          ))}
        </div>
      </div>
    </div>
  );
}

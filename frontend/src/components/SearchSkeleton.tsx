export function SearchSkeleton() {
  return (
    <main className="max-w-[672px] w-full mx-auto py-6 space-y-4">
      <div className="space-y-2">
        <div className="h-6 w-32 bg-white/10 rounded animate-pulse" />
        <div className="h-4 w-56 bg-white/5 rounded animate-pulse" />
      </div>

      <div className="card p-4 space-y-3">
        <div className="h-10 w-full rounded-xl border border-white/10 bg-white/5 animate-pulse" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-8 w-24 rounded-full border border-white/10 bg-white/5 animate-pulse"
            />
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="card p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-40 bg-white/10 rounded animate-pulse" />
              <div className="h-3 w-56 bg-white/5 rounded animate-pulse" />
            </div>
            <div className="h-8 w-24 rounded-full bg-white/10 animate-pulse" />
          </div>
        ))}
      </div>
    </main>
  );
}


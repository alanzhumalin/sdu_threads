export function NotificationsSkeleton() {
  return (
    <main className="max-w-[672px] w-full mx-auto py-6 space-y-4">
      <div className="space-y-2">
        <div className="h-6 w-44 bg-white/10 rounded animate-pulse" />
        <div className="h-4 w-64 bg-white/5 rounded animate-pulse" />
      </div>

      <div className="card p-4 space-y-3">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-white/10 animate-pulse" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-72 bg-white/10 rounded animate-pulse" />
              <div className="h-3 w-40 bg-white/5 rounded animate-pulse" />
            </div>
            <div className="h-3 w-14 bg-white/5 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </main>
  );
}


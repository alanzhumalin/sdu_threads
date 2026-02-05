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
            <div key={n} className="card p-4 md:p-4 animate-pulse space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-white/10" />
                  <div className="space-y-2">
                    <div className="h-3 w-32 bg-white/10 rounded-full" />
                    <div className="h-2 w-20 bg-white/5 rounded-full" />
                  </div>
                </div>
                <div className="h-8 w-24 rounded-full bg-white/5" />
              </div>

              <div className="space-y-2">
                <div className="h-3 w-full bg-white/10 rounded-full" />
                <div className="h-3 w-5/6 bg-white/10 rounded-full" />
                <div className="h-3 w-2/3 bg-white/10 rounded-full" />
              </div>

              <div className="h-40 rounded-2xl bg-white/5" />

              <div className="flex items-center justify-between pt-1">
                <div className="h-8 w-28 rounded-full bg-white/5" />
                <div className="h-8 w-16 rounded-full bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


type Props = {
  withMedia?: boolean;
  className?: string;
};

export function PostSkeleton({ withMedia = true, className = "" }: Props) {
  return (
    <div className={"card p-4 md:p-4 animate-pulse space-y-3 " + className}>
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

      {withMedia && <div className="h-40 rounded-2xl bg-white/5" />}

      <div className="flex items-center justify-between pt-1">
        <div className="h-8 w-28 rounded-full bg-white/5" />
        <div className="h-8 w-16 rounded-full bg-white/5" />
      </div>
    </div>
  );
}


type Props = {
  className?: string;
};

export function CommentSkeleton({ className = "" }: Props) {
  return (
    <div
      className={
        "border border-white/10 rounded-xl p-3 flex gap-3 animate-pulse " + className
      }
    >
      <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <div className="h-3 w-28 bg-white/10 rounded-full" />
          <div className="h-2 w-16 bg-white/5 rounded-full" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-full bg-white/10 rounded-full" />
          <div className="h-3 w-4/5 bg-white/10 rounded-full" />
        </div>
        <div className="h-3 w-24 bg-white/5 rounded-full" />
      </div>
    </div>
  );
}


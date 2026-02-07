import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MentionPreview } from "./MentionPreview";

export type UserRowData = {
  id: string;
  username: string;
  full_name?: string;
  avatar_url?: string;
};

type Props = {
  user: UserRowData;
  right?: ReactNode;
};

export function UserRow({ user, right }: Props) {
  const initials = (user.full_name?.[0] || user.username?.[0] || "U").toUpperCase();

  return (
    <div className="card p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <Link to={`/u/${user.username}`} className="w-10 h-10 rounded-full bg-white/10 shrink-0 overflow-hidden flex items-center justify-center text-sm font-semibold">
          {user.avatar_url ? (
            <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
          ) : (
            initials
          )}
        </Link>

        <div className="min-w-0">
          <p className="text-white font-semibold truncate">
            <MentionPreview
              username={user.username}
              className="text-white font-semibold hover:underline"
            >
              <Link to={`/u/${user.username}`} className="text-white">
                {user.full_name || "Без имени"}
              </Link>
            </MentionPreview>
          </p>
          <p className="text-white/60 text-xs truncate">@{user.username}</p>
        </div>
      </div>

      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

export function UserRowSkeleton() {
  return (
    <div className="card p-3 flex items-center gap-3 animate-pulse">
      <div className="w-10 h-10 rounded-full bg-white/10 shrink-0" />
      <div className="space-y-2 w-full">
        <div className="h-3 bg-white/10 rounded-full w-2/5" />
        <div className="h-2 bg-white/5 rounded-full w-1/4" />
      </div>
    </div>
  );
}

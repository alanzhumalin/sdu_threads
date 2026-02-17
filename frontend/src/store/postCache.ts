import { create } from "zustand";

export type PostPatch = {
  liked_by_me?: boolean;
  like_count?: number;
  comment_count?: number;
  view_count?: number;
  is_subscribed?: boolean;
  reactions?: {
    emoji: string;
    count: number;
    reacted_by_me: boolean;
  }[];
};

type State = {
  byId: Record<string, PostPatch>;
  patch: (postId: string, patch: PostPatch) => void;
  clear: () => void;
};

export const usePostCacheStore = create<State>((set) => ({
  byId: {},
  patch: (postId, patch) =>
    set((state) => ({
      byId: {
        ...state.byId,
        [postId]: { ...(state.byId[postId] || {}), ...patch },
      },
    })),
  clear: () => set({ byId: {} }),
}));

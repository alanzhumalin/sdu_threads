import { create } from "zustand";

type State = {
  byUserId: Record<string, boolean>;
  version: number;
};

type Actions = {
  setFollow: (userId: string, isSubscribed: boolean) => void;
  setManyFromPosts: (posts: { user_id?: string; is_subscribed?: boolean }[]) => void;
  clear: () => void;
};

export const useSubscriptionsStore = create<State & Actions>((set) => ({
  byUserId: {},
  version: 0,
  setFollow: (userId, isSubscribed) =>
    set((state) => {
      const prev = state.byUserId[userId];
      if (prev === isSubscribed) return state;
      return {
        byUserId: { ...state.byUserId, [userId]: isSubscribed },
        version: state.version + 1,
      };
    }),
  setManyFromPosts: (posts) =>
    set((state) => {
      const next = { ...state.byUserId };
      posts.forEach((p) => {
        if (p.user_id && typeof p.is_subscribed === "boolean") {
          next[p.user_id] = p.is_subscribed;
        }
      });
      return { ...state, byUserId: next };
    }),
  clear: () => set({ byUserId: {}, version: 0 }),
}));

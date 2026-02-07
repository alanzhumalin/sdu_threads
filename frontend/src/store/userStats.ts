import { create } from "zustand";

type Counts = {
  followers?: number;
  following?: number;
};

type State = {
  byUserId: Record<string, Counts>;
  version: number;
};

type Actions = {
  setCounts: (userId: string, counts: Counts) => void;
  patchCounts: (userId: string, delta: { followers?: number; following?: number }) => void;
  clear: () => void;
};

export const useUserStatsStore = create<State & Actions>((set) => ({
  byUserId: {},
  version: 0,
  setCounts: (userId, counts) =>
    set((state) => ({
      byUserId: {
        ...state.byUserId,
        [userId]: { ...(state.byUserId[userId] || {}), ...counts },
      },
      version: state.version + 1,
    })),
  patchCounts: (userId, delta) =>
    set((state) => {
      const existing = state.byUserId[userId] || {};
      const next: Counts = { ...existing };

      // Apply deltas only when we know the baseline, to avoid incorrect counters.
      if (typeof delta.followers === "number" && typeof existing.followers === "number") {
        next.followers = Math.max(0, existing.followers + delta.followers);
      }
      if (typeof delta.following === "number" && typeof existing.following === "number") {
        next.following = Math.max(0, existing.following + delta.following);
      }

      const changed =
        (typeof next.followers === "number" && next.followers !== existing.followers) ||
        (typeof next.following === "number" && next.following !== existing.following);
      if (!changed) return state;

      return {
        byUserId: { ...state.byUserId, [userId]: next },
        version: state.version + 1,
      };
    }),
  clear: () => set({ byUserId: {}, version: 0 }),
}));


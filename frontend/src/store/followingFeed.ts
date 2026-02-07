import { create } from "zustand";
import { useSubscriptionsStore } from "./subscriptions";

type FeedItem = {
  id: string;
  [key: string]: any;
};

type State = {
  items: FeedItem[];
  nextOffset: number | null;
  initialized: boolean;
  setCache: (items: FeedItem[], nextOffset: number | null) => void;
  upsertMany: (items: FeedItem[]) => void;
  updateItem: (id: string, patch: Partial<FeedItem>) => void;
  updateByUser: (userId: string, patch: Partial<FeedItem>) => void;
  clear: () => void;
};

export const useFollowingFeedStore = create<State>((set) => ({
  items: [],
  nextOffset: null,
  initialized: false,
  setCache: (items, nextOffset) => {
    useSubscriptionsStore.getState().setManyFromPosts(items as any[]);
    set({ items, nextOffset, initialized: true });
  },
  upsertMany: (incoming) =>
    set((state) => {
      if (!incoming.length) return state;
      const byId = new Map(state.items.map((p) => [p.id, p] as const));
      incoming.forEach((p) => {
        const existing = byId.get(p.id);
        byId.set(p.id, existing ? { ...existing, ...p } : p);
      });
      useSubscriptionsStore.getState().setManyFromPosts(incoming as any[]);
      return { ...state, items: Array.from(byId.values()) };
    }),
  updateItem: (id, patch) =>
    set((state) => ({
      ...state,
      items: state.items.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  updateByUser: (userId, patch) =>
    set((state) => ({
      ...state,
      items: state.items.map((p) => (p.user_id === userId ? { ...p, ...patch } : p)),
    })),
  clear: () => set({ items: [], nextOffset: null, initialized: false }),
}));


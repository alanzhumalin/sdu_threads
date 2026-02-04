import { create } from "zustand";

type FeedItem = {
  id: string;
  [key: string]: any;
};

type FeedState = {
  items: FeedItem[];
  nextOffset: number | null;
  initialized: boolean;
  setCache: (items: FeedItem[], nextOffset: number | null) => void;
  upsertMany: (items: FeedItem[]) => void;
  updateItem: (id: string, patch: Partial<FeedItem>) => void;
  updateByUser: (userId: string, patch: Partial<FeedItem>) => void;
};

export const useFeedStore = create<FeedState>((set) => ({
  items: [],
  nextOffset: null,
  initialized: false,
  setCache: (items, nextOffset) => set({ items, nextOffset, initialized: true }),
  upsertMany: (incoming) =>
    set((state) => {
      if (!incoming.length) return state;
      const byId = new Map(state.items.map((p) => [p.id, p] as const));
      incoming.forEach((p) => {
        const existing = byId.get(p.id);
        byId.set(p.id, existing ? { ...existing, ...p } : p);
      });
      return { ...state, items: Array.from(byId.values()) };
    }),
  updateItem: (id, patch) =>
    set((state) => ({
      items: state.items.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    })),
  updateByUser: (userId, patch) =>
    set((state) => ({
      items: state.items.map((p) => (p.user_id === userId ? { ...p, ...patch } : p)),
    })),
}));

import { create } from "zustand";

type State = {
  unreadCount: number;
};

type Actions = {
  setUnreadCount: (n: number) => void;
  incrementUnread: (delta?: number) => void;
};

export const useNotificationStore = create<State & Actions>((set) => ({
  unreadCount: 0,
  setUnreadCount: (n: number) => set({ unreadCount: n }),
  incrementUnread: (delta = 1) =>
    set((state) => ({ unreadCount: Math.max(0, state.unreadCount + delta) })),
}));

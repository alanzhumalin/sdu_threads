import { create } from "zustand";

type State = {
  unreadCount: number;
};

type Actions = {
  setUnreadCount: (n: number) => void;
};

export const useChatStore = create<State & Actions>((set) => ({
  unreadCount: 0,
  setUnreadCount: (n: number) => set({ unreadCount: Math.max(0, n) }),
}));

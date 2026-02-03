import { create } from "zustand";

type State = {
  unreadCount: number;
};

type Actions = {
  setUnreadCount: (n: number) => void;
};

export const useNotificationStore = create<State & Actions>((set) => ({
  unreadCount: 0,
  setUnreadCount: (n: number) => set({ unreadCount: n }),
}));

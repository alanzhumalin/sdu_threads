import { create } from "zustand";
import { useFeedStore } from "./feed";
import { useNotificationStore } from "./notifications";
import { useChatStore } from "./chats";
import { usePostCacheStore } from "./postCache";
import { useProfileMeStore } from "./profileMe";
import { usePostCooldownStore } from "./postCooldown";
import { useSubscriptionsStore } from "./subscriptions";
import { useFollowingFeedStore } from "./followingFeed";
import { useUserStatsStore } from "./userStats";

type AuthState = {
  token: string | null;
  setToken: (t: string | null) => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  token: localStorage.getItem("token"),
  setToken: (t) => {
    const prev = get().token;
    if (t) {
      localStorage.setItem("token", t);
    } else {
      localStorage.removeItem("token");
    }
    set({ token: t });

    if (prev !== t) {
      // Per-user caches should not leak between auth sessions.
      useProfileMeStore.getState().clear();
      usePostCacheStore.getState().clear();
      useFeedStore.getState().setCache([], null);
      useNotificationStore.getState().setUnreadCount(0);
      useChatStore.getState().setUnreadCount(0);
      usePostCooldownStore.getState().clear();
      useSubscriptionsStore.getState().clear();
      useUserStatsStore.getState().clear();
      useFollowingFeedStore.getState().clear();
    }
  },
}));

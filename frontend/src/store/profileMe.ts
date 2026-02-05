import { create } from "zustand";

type PostsCache = {
  items: any[];
  nextOffset: number | null;
  loaded: boolean;
};

type State = {
  profile: any | null;
  myPosts: PostsCache;
  likedPosts: PostsCache;
  setProfile: (profile: any | null) => void;
  setMyPosts: (items: any[], nextOffset: number | null, loaded?: boolean) => void;
  setLikedPosts: (items: any[], nextOffset: number | null, loaded?: boolean) => void;
  clear: () => void;
};

export const useProfileMeStore = create<State>((set) => ({
  profile: null,
  myPosts: { items: [], nextOffset: null, loaded: false },
  likedPosts: { items: [], nextOffset: null, loaded: false },
  setProfile: (profile) => set({ profile }),
  setMyPosts: (items, nextOffset, loaded = true) =>
    set({ myPosts: { items, nextOffset, loaded } }),
  setLikedPosts: (items, nextOffset, loaded = true) =>
    set({ likedPosts: { items, nextOffset, loaded } }),
  clear: () =>
    set({
      profile: null,
      myPosts: { items: [], nextOffset: null, loaded: false },
      likedPosts: { items: [], nextOffset: null, loaded: false },
    }),
}));


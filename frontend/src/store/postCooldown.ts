import { create } from "zustand";

type State = {
  untilMs: number;
  setUntilMs: (ms: number) => void;
  clear: () => void;
};

// Global per-user cooldown for creating posts (UX only; backend is the source of truth).
export const usePostCooldownStore = create<State>((set) => ({
  untilMs: 0,
  setUntilMs: (ms) => set({ untilMs: ms }),
  clear: () => set({ untilMs: 0 }),
}));


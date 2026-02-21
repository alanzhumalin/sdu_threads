import { create } from "zustand";

type AuthGateState = {
  open: boolean;
  title?: string;
  message?: string;
  ctaLabel?: string;
  show: (opts?: { title?: string; message?: string; ctaLabel?: string }) => void;
  hide: () => void;
};

export const useAuthGateStore = create<AuthGateState>((set) => ({
  open: false,
  title: "",
  message: "",
  ctaLabel: "",
  show: (opts) =>
    set({
      open: true,
      title: opts?.title ?? "",
      message: opts?.message ?? "",
      ctaLabel: opts?.ctaLabel ?? "",
    }),
  hide: () => set({ open: false }),
}));

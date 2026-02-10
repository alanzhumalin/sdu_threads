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
  title: "Сначала авторизуйся",
  message: "Чтобы продолжить, нужно войти в аккаунт.",
  ctaLabel: "Войти",
  show: (opts) =>
    set({
      open: true,
      title: opts?.title ?? "Сначала авторизуйся",
      message: opts?.message ?? "Чтобы продолжить, нужно войти в аккаунт.",
      ctaLabel: opts?.ctaLabel ?? "Войти",
    }),
  hide: () => set({ open: false }),
}));


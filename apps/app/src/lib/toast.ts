import { create } from 'zustand';

interface ToastAction {
  label: string;
  run: () => void;
}

interface ToastState {
  id: number;
  text: string | null;
  action: ToastAction | null;
  show: (text: string, action?: ToastAction) => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | null = null;

export const useToast = create<ToastState>((set) => ({
  id: 0,
  text: null,
  action: null,
  show: (text, action) => {
    if (timer) clearTimeout(timer);
    set((s) => ({ id: s.id + 1, text, action: action ?? null }));
    timer = setTimeout(() => set({ text: null, action: null }), action ? 5000 : 3500);
  },
  hide: () => {
    if (timer) clearTimeout(timer);
    set({ text: null, action: null });
  },
}));

export const toast = {
  show: (text: string, action?: ToastAction) => useToast.getState().show(text, action),
};

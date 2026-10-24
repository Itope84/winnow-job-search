import AsyncStorage from '@react-native-async-storage/async-storage';
import type { JobList } from '@winnow/api';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

/** Per-device conveniences only. Everything that matters lives on the server. */
interface Prefs {
  theme: 'system' | 'light' | 'dark';
  /** The list Jobs opens on. */
  lastList: JobList;
  /** The person who chose "Finish later" in setup on this device, so it stops opening by itself. */
  setupLater: string | null;
  hydrated: boolean;
  setTheme: (t: Prefs['theme']) => void;
  setLastList: (l: JobList) => void;
  setSetupLater: (id: string | null) => void;
}

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: 'system',
      lastList: 'inbox',
      setupLater: null,
      hydrated: false,
      setTheme: (theme) => set({ theme }),
      setLastList: (lastList) => set({ lastList }),
      setSetupLater: (setupLater) => set({ setupLater }),
    }),
    {
      name: 'winnow-prefs',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ theme, lastList, setupLater }) => ({ theme, lastList, setupLater }),
      onRehydrateStorage: () => () => usePrefs.setState({ hydrated: true }),
    },
  ),
);

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AuthUser } from '@signacare/shared';

type AuthState = {
  user: AuthUser | null;
  isAuthenticated: boolean;
  requiresMfa: boolean;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
  setRequiresMfa: (value: boolean) => void;
  login: (user: AuthUser) => void;
  logout: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      requiresMfa: false,
      setUser: (user: AuthUser) =>
        set({ user, isAuthenticated: true, requiresMfa: false }),
      clearUser: () =>
        set({ user: null, isAuthenticated: false, requiresMfa: false }),
      setRequiresMfa: (value: boolean) =>
        set({ requiresMfa: value }),
      login: (user: AuthUser) =>
        set({ user, isAuthenticated: true, requiresMfa: false }),
      logout: () =>
        set({ user: null, isAuthenticated: false, requiresMfa: false }),
    }),
    {
      name: 'signacare-auth',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state: AuthState) => ({ user: state.user }),
      // BUG-032 L3/L5 review — reconcile isAuthenticated on rehydration.
      // partialize only persists `user`, so on browser refresh Zustand
      // merges `{user}` into the initial store where `isAuthenticated`
      // defaults to false. AuthGuard then redirects to /login despite
      // a valid cookie, and the user is forced to re-login after every
      // refresh. Derive isAuthenticated from user presence on hydrate
      // so a refresh preserves the session.
      onRehydrateStorage: () => (state) => {
        if (state && state.user) {
          state.isAuthenticated = true;
        }
      },
    },
  ),
);

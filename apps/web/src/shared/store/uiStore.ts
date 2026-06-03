import { create, StateCreator } from 'zustand';

export interface GlobalNotification {
  id: string;
  message: string;
  severity?: 'success' | 'info' | 'warning' | 'error';
}

export interface UiState {
  sidebarOpen: boolean;
  activePage: string | undefined;
  globalLoading: boolean;
  notifications: GlobalNotification[];
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActivePage: (page: string | undefined) => void;
  setGlobalLoading: (loading: boolean) => void;
  addNotification: (n: GlobalNotification) => void;
  dismissNotification: (id: string) => void;
}

const storeCreator: StateCreator<UiState> = (set) => ({
  sidebarOpen: true,
  activePage: undefined,
  globalLoading: false,
  notifications: [],
  toggleSidebar: () =>
    set((s: UiState) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open: boolean) =>
    set({ sidebarOpen: open }),
  setActivePage: (page: string | undefined) =>
    set({ activePage: page }),
  setGlobalLoading: (loading: boolean) =>
    set({ globalLoading: loading }),
  addNotification: (n: GlobalNotification) =>
    set((s: UiState) => ({
      notifications: [...s.notifications, n],
    })),
  dismissNotification: (id: string) =>
    set((s: UiState) => ({
      notifications: s.notifications.filter(
        (n: GlobalNotification) => n.id !== id,
      ),
    })),
});

export const useUiStore = create<UiState>(storeCreator);

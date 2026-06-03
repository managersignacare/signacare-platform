import { create } from 'zustand';

interface SessionState {
  scribeActive: boolean;
  setScribeActive: (active: boolean) => void;
  showSessionWarning: boolean;
  setShowSessionWarning: (show: boolean) => void;
  secondsLeft: number;
  setSecondsLeft: (seconds: number) => void;
  draftCount: number;
  setDraftCount: (count: number) => void;
  /** True briefly after auto-logout so the UI can show "Session expired" */
  sessionExpired: boolean;
  setSessionExpired: (expired: boolean) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  scribeActive: false,
  setScribeActive: (active) => set({ scribeActive: active }),
  showSessionWarning: false,
  setShowSessionWarning: (show) => set({ showSessionWarning: show }),
  secondsLeft: 0,
  setSecondsLeft: (seconds) => set({ secondsLeft: seconds }),
  draftCount: 0,
  setDraftCount: (count) => set({ draftCount: count }),
  sessionExpired: false,
  setSessionExpired: (expired) => set({ sessionExpired: expired }),
}));

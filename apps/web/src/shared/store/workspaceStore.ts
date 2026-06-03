import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface PatientTab {
  id: string;          // patient UUID
  name: string;        // display name
  emrNumber: string;
  activeSubTab?: string; // which detail tab is active
}

interface WorkspaceState {
  tabs: PatientTab[];
  activeTabId: string | null;
  openTab: (patient: { id: string; name: string; emrNumber: string }) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateSubTab: (patientId: string, subTab: string) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      tabs: [],
      activeTabId: null,

      openTab: (patient) => {
        const { tabs } = get();
        const existing = tabs.find(t => t.id === patient.id);
        if (existing) {
          set({ activeTabId: patient.id });
        } else {
          set({
            tabs: [...tabs, { id: patient.id, name: patient.name, emrNumber: patient.emrNumber }],
            activeTabId: patient.id,
          });
        }
      },

      closeTab: (id) => {
        const { tabs, activeTabId } = get();
        const newTabs = tabs.filter(t => t.id !== id);
        let newActive = activeTabId;
        if (activeTabId === id) {
          const idx = tabs.findIndex(t => t.id === id);
          newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? null;
        }
        set({ tabs: newTabs, activeTabId: newActive });
      },

      setActiveTab: (id) => set({ activeTabId: id }),

      updateSubTab: (patientId, subTab) => {
        set(state => ({
          tabs: state.tabs.map(t => t.id === patientId ? { ...t, activeSubTab: subTab } : t),
        }));
      },
    }),
    {
      name: 'signacare-workspace',
      // Use sessionStorage instead of localStorage to avoid PHI persisting across sessions.
      // Patient names and EMR numbers are PHI and should not survive browser restarts.
      storage: {
        getItem: (name) => {
          const v = sessionStorage.getItem(name);
          return v ? JSON.parse(v) : null;
        },
        setItem: (name, value) => sessionStorage.setItem(name, JSON.stringify(value)),
        removeItem: (name) => sessionStorage.removeItem(name),
      },
    }
  )
);

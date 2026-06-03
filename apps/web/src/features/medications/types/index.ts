// apps/web/src/features/medications/types/index.ts
//
// BUG-603 — canonical SSoT entry point for the medications feature's
// types folder. Pre-fix two parallel type homes coexisted:
//   - apps/web/src/features/medications/types.ts        (NEW BUG-524-B)
//   - apps/web/src/features/medications/types/medicationTypes.ts (older)
// Future contributors had to guess which file to add a new domain type
// to. CLAUDE.md Standard 3 (SSoT) violation. Post-fix the flat
// `types.ts` is deleted, this folder index becomes the canonical
// import target, and existing consumers using either `from '../types'`
// (now resolves to this index) or `from '../types/medicationTypes'`
// (still resolves to the granular file) both continue to work.

// Re-export everything from medicationTypes (status enums + display
// constants + ROUTES/FREQUENCIES generic arrays).
export * from './medicationTypes';

// Row + drug-search result shapes (relocated from the deleted flat
// `types.ts` per BUG-524-B). Consumers: CurrentMedsPanel, LaiPanel,
// ClozapinePanel, MedicationHistoryTab, MedHistoryPanel,
// PrescriptionHistoryPanel, PrescribeDialog, TaperDialog,
// usePrescriber.
export interface MedicationRow {
  id: string;
  medicationName: string;
  genericName: string | null;
  dose: string;
  frequency: string;
  route: string;
  status: string;
  isLai: boolean;
  isClozapine: boolean;
  isS8: boolean;
  laiFrequency: string | null;
  laiNextDue: string | null;
  laiLastAdmin: string | null;
  prescribedAt: string | null;
  prescriber: string | null;
  createdAt: string;
  quantity?: number | null;
  repeats?: number | null;
  pbsCode?: string | null;
  indication?: string | null;
}

export interface RxDrugResult {
  rxcui: string;
  name: string;
  synonym: string;
  tty: string; // SBD, SCD, GPCK etc
}

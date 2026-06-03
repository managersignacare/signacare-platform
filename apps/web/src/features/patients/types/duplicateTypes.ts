// apps/web/src/features/patients/types/duplicateTypes.ts
//
// Frontend types for the patient-duplicate detection flow.
// Mirrors the backend response shape from `POST /patients/duplicates/check`
// (defined in `apps/api/src/features/patients/duplicateRoutes.ts` +
// `findDuplicateCandidates` in `duplicateDetection.ts`) but uses
// camelCase per the canonical frontend contract (CLAUDE.md §5.2:
// "Backend must map snake_case DB columns to camelCase response
// fields"). The /duplicates/check endpoint INTENTIONALLY returns
// snake_case raw rows + INTENTIONALLY strips Medicare/IHI/DVA from
// the response (see duplicateDetection.ts:255 and the privacy
// rationale in the comment block above it). The frontend hook
// `useCheckDuplicatePatients` does the snake→camel translation at the
// boundary so the rest of the UI consumes a clean camelCase shape.
//
// `DuplicatePatientDisplay` deliberately includes ONLY the fields the
// `DuplicatePatientModal` actually displays — `id` (for click-through
// to the chart), `emrNumber` (the canonical patient identifier shown
// in the modal), `givenName` + `familyName` + `dateOfBirth` (the three
// signals a clinician needs to recognise an existing record). The
// modal does NOT show Medicare or address; the backend strips Medicare
// regardless. Keeping this shape minimal preserves the privacy-by-
// scope intent of the duplicates/check endpoint.

export interface DuplicatePatientDisplay {
  id: string;
  emrNumber: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
}

export interface DuplicateCheckCandidate {
  patient: DuplicatePatientDisplay;
  score: number;
  confidence: 'definite' | 'strong' | 'probable';
  matchedOn: string[];
}

export interface DuplicateCheckThresholds {
  probable: number;
  strong: number;
  definite: number;
}

export interface DuplicateCheckResponse {
  candidates: DuplicateCheckCandidate[];
  thresholdsUsed: DuplicateCheckThresholds;
}

export interface DuplicateCheckInput {
  givenName: string;
  familyName: string;
  dateOfBirth: string;
  medicareNumber?: string | null;
  ihiNumber?: string | null;
  dvaNumber?: string | null;
  phoneMobile?: string | null;
  addressLine1?: string | null;
  postcode?: string | null;
  excludePatientId?: string;
}

// Raw backend response shape (snake_case row, identifiers stripped).
// Used by `useCheckDuplicatePatients` to type the apiClient.post
// return value BEFORE the snake→camel mapper runs. Exported (the hook
// imports it) but the boundary discipline is: only the hook ever
// reads a `Raw*` shape; any other consumer should consume the
// camelCase `DuplicateCheckResponse` only.
export interface RawDuplicatePatientRow {
  id: string;
  emr_number: string;
  given_name: string;
  family_name: string;
  date_of_birth: string;
  // Other PatientRow columns may be present but are NOT consumed by the
  // frontend; we deliberately do not declare them so the type system
  // surfaces any future drift between the endpoint payload and the
  // display contract.
}

export interface RawDuplicateCheckCandidate {
  patient: RawDuplicatePatientRow;
  score: number;
  confidence: 'definite' | 'strong' | 'probable';
  matchedOn: string[];
}

export interface RawDuplicateCheckResponse {
  candidates: RawDuplicateCheckCandidate[];
  thresholdsUsed: DuplicateCheckThresholds;
}

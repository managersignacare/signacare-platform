// apps/web/src/features/patients/hooks/useCheckDuplicatePatients.ts
//
// Mutation hook that POSTs to the patient-duplicate-check endpoint and
// translates the backend's snake_case raw-row response into the
// camelCase `DuplicateCheckResponse` shape the frontend consumes.
//
// Endpoint contract (apps/api/src/features/patients/duplicateRoutes.ts):
//   POST /patients/duplicates/check
//   body: DuplicateCheckInput
//   returns: { candidates: RawDuplicateCheckCandidate[], thresholdsUsed }
//
// The /duplicates/check endpoint intentionally returns the raw
// PatientRow shape (snake_case) without decryption, because the columns
// the frontend cares about for duplicate-display (given_name,
// family_name, date_of_birth, emr_number) are stored as PLAINTEXT —
// they are NOT in `ENCRYPTED_PHI_COLUMNS` (see
// apps/api/src/shared/phiEncryption.ts:141-157). Skipping
// decryptPatientPhi avoids the cost of decrypting fields the
// duplicate-display does not need (phone, address, contacts) and
// preserves the privacy-by-scope discipline.
//
// Lands the structural part of BUG-447-FOLLOWUP-WIZARD-PREFLIGHT-
// DUPLICATE-CHECK. Wizard wiring lands in the same atomic commit.

import { useMutation } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import type {
  DuplicateCheckInput,
  DuplicateCheckResponse,
  RawDuplicateCheckResponse,
  RawDuplicatePatientRow,
  DuplicatePatientDisplay,
} from '../types/duplicateTypes';

function toDisplay(raw: RawDuplicatePatientRow): DuplicatePatientDisplay {
  return {
    id: raw.id,
    emrNumber: raw.emr_number,
    givenName: raw.given_name,
    familyName: raw.family_name,
    dateOfBirth: raw.date_of_birth,
  };
}

function toCamelCaseResponse(raw: RawDuplicateCheckResponse): DuplicateCheckResponse {
  return {
    candidates: raw.candidates.map((c) => ({
      patient: toDisplay(c.patient),
      score: c.score,
      confidence: c.confidence,
      matchedOn: c.matchedOn,
    })),
    thresholdsUsed: raw.thresholdsUsed,
  };
}

export function useCheckDuplicatePatients() {
  // @no-invalidate-needed: duplicate-check endpoint is read-only preflight and does not mutate cached state.
  return useMutation({
    mutationFn: async (input: DuplicateCheckInput): Promise<DuplicateCheckResponse> => {
      const raw = await apiClient.post<RawDuplicateCheckResponse>('patients/duplicates/check', input);
      return toCamelCaseResponse(raw);
    },
  });
}

// apps/web/src/features/risk-allergies/types/allergyTypes.ts
//
// Phase 0.7 PR3 Class D — TYPEDUP:AllergyResponse / CreateAllergyDTO /
// UpdateAllergyDTO. The frontend used to redeclare the allergy schema
// with three drifted field names:
//
//   frontend                  backend (shared)
//   --------                  ----------------
//   reactionType: string      reaction: string
//   onsetDate: yyyy-mm-dd     recordedAt: ISO datetime
//   isActive: boolean         status: 'active' | 'inactive' | 'entered_in_error'
//
// AllergyForm.tsx and AllergyList.tsx both read the frontend names, so
// every allergy listed in the UI rendered "—" for the reaction column
// and undefined for the date / status columns since the feature
// shipped. Real silent shipped bug.
//
// Fix: drop the local schemas, re-export from shared, and update the
// two consumers to use the shared field names.

import { z } from 'zod';
export type {
  AllergyResponse,
  CreateAllergyDTO,
  UpdateAllergyDTO,
} from '@signacare/shared';
export {
  CreateAllergySchema,
  UpdateAllergySchema,
  AllergyResponseSchema,
  AllergySeverityEnum,
  AllergyStatusEnum,
} from '@signacare/shared';
import type { AllergyResponse } from '@signacare/shared';

// AllergenType is not exported from shared as a standalone enum — the
// values live inside CreateAllergySchema.allergenType. Re-declare the
// enum here for the form's allergen-type Select component.
export const AllergenTypeEnum = z.enum([
  'drug', 'food', 'environmental', 'contrast', 'latex', 'other',
]);
export type AllergenType = z.infer<typeof AllergenTypeEnum>;

export type AllergySeverity = AllergyResponse['severity'];

// ─── Frontend Display Config ──────────────────────────────────────────────────

export const SEVERITY_CONFIG: Readonly<
  Record<AllergySeverity, {
    label:      string;
    colour:     string;
    chipColour: 'default' | 'success' | 'warning' | 'error';
  }>
> = {
  unknown:          { label: 'Unknown',          colour: '#9E9E9E', chipColour: 'default'  },
  mild:             { label: 'Mild',             colour: '#4E9C82', chipColour: 'success'  },
  moderate:         { label: 'Moderate',         colour: '#F0852C', chipColour: 'warning'  },
  severe:           { label: 'Severe',           colour: '#D32F2F', chipColour: 'error'    },
  life_threatening: { label: 'Life Threatening', colour: '#B71C1C', chipColour: 'error'    },
} as const;

export const ALLERGEN_TYPE_LABELS: Readonly<Record<AllergenType, string>> = {
  drug:          'Drug / Medication',
  food:          'Food',
  environmental: 'Environmental',
  contrast:      'Contrast Media',
  latex:         'Latex',
  other:         'Other',
} as const;

export function isHighSeverityAllergy(severity: AllergySeverity): boolean {
  return severity === 'severe' || severity === 'life_threatening';
}

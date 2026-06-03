export type LaiOutcome = 'given' | 'refused' | 'deferred' | 'partial';
export type LaiScheduleStatus = 'active' | 'paused' | 'ceased';

export const LAI_OUTCOME_LABEL: Record<LaiOutcome, string> = {
  given: 'Given',
  refused: 'Refused',
  deferred: 'Deferred',
  partial: 'Partial',
};

export const LAI_OUTCOME_COLOR: Record<LaiOutcome, string> = {
  given: '#4E9C82',
  refused: '#D32F2F',
  deferred: '#F0852C',
  partial: '#F0852C',
};

export const INJECTION_SITES = ['gluteal', 'deltoid', 'vastus lateralis', 'ventrogluteal'];
export const INJECTION_TECHNIQUES = ['IM', 'deep IM', 'Z-track'];
export const NEEDLE_GAUGES = ['21G', '22G', '23G', '25G'];

export const AIMS_ITEMS: { key: string; label: string }[] = [
  { key: 'muscles_face', label: '1. Muscles of facial expression' },
  { key: 'lips_perioral', label: '2. Lips and perioral area' },
  { key: 'jaw', label: '3. Jaw' },
  { key: 'tongue', label: '4. Tongue' },
  { key: 'upper_extremities', label: '5. Upper extremities (arms, wrists, hands, fingers)' },
  { key: 'lower_extremities', label: '6. Lower extremities (legs, knees, ankles, toes)' },
  { key: 'neck_shoulders', label: '7. Neck, shoulders, hips' },
  { key: 'global_severity', label: '8. Global severity (rater)' },
  { key: 'incapacitation', label: '9. Incapacitation due to abnormal movements' },
  { key: 'awareness', label: '10. Patient awareness of movements' },
];

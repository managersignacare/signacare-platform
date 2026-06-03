export type MedicationStatus =
  | 'active'
  | 'tapering'
  | 'ceased'
  | 'ceased_discontinued'
  | 'suspended'
  | 'on_hold'
  | 'paused'
  | 'draft';

export const MEDICATION_STATUS_LABEL: Record<MedicationStatus, string> = {
  active: 'Active',
  tapering: 'Tapering',
  ceased: 'Ceased',
  ceased_discontinued: 'Ceased (Discontinued)',
  suspended: 'Suspended',
  on_hold: 'On Hold',
  paused: 'Paused',
  draft: 'Draft',
};

export const MEDICATION_STATUS_COLOR: Record<MedicationStatus, string> = {
  active: '#4E9C82',
  tapering: '#F0852C',
  ceased: '#9E9E9E',
  ceased_discontinued: '#9E9E9E',
  suspended: '#F0852C',
  on_hold: '#9E9E9E',
  paused: '#D4A017',
  draft: '#607D8B',
};

export const ROUTES = ['oral', 'IM', 'IV', 'SC', 'sublingual', 'topical', 'inhaled', 'PR', 'nasogastric'];

export const FREQUENCIES = [
  'daily',
  'twice daily',
  'three times daily',
  'four times daily',
  'every morning',
  'every night',
  'every other day',
  'weekly',
  'fortnightly',
  'monthly',
  'as required (PRN)',
  'stat',
];

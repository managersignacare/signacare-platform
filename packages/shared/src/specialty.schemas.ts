import { z } from 'zod';

/**
 * Canonical list of clinical specialty codes supported by Signacare.
 *
 * These codes are the business keys used end-to-end: shared DTOs, API
 * responses, URL query params, React module registry, and the `specialties`
 * lookup table's primary key. Database migrations seed one row per code.
 * Display strings and icons are resolved from the maps below so the frontend
 * doesn't need to query the lookup table for rendering.
 *
 * To add a new specialty: (1) add its code here, (2) add an entry to each
 * map below, (3) add a migration that INSERTs the row into `specialties`.
 */
export const SpecialtyTypeEnum = z.enum([
  'mental_health',
  'general_medicine',
  'endocrinology',
  'paediatrics',
  'obstetrics_gynaecology',
  'surgery',
  'oncology',
]);

export type SpecialtyType = z.infer<typeof SpecialtyTypeEnum>;

export const SPECIALTY_DISPLAY: Record<SpecialtyType, string> = {
  mental_health: 'Mental Health',
  general_medicine: 'Internal Medicine',
  endocrinology: 'Endocrinology',
  paediatrics: 'Paediatrics',
  obstetrics_gynaecology: 'Obstetrics & Gynaecology',
  surgery: 'Surgery',
  oncology: 'Oncology',
};

export const SPECIALTY_ICON: Record<SpecialtyType, string> = {
  mental_health: 'Psychology',
  general_medicine: 'MedicalServices',
  endocrinology: 'Bloodtype',
  paediatrics: 'ChildCare',
  obstetrics_gynaecology: 'PregnantWoman',
  surgery: 'ContentCut',
  oncology: 'Coronavirus',
};

export const SPECIALTY_COLOR: Record<SpecialtyType, string> = {
  mental_health: '#7B1FA2',
  general_medicine: '#1976D2',
  endocrinology: '#F57C00',
  paediatrics: '#388E3C',
  obstetrics_gynaecology: '#C2185B',
  surgery: '#455A64',
  oncology: '#D32F2F',
};

/**
 * SNOMED CT clinical specialty codes (system 394658006 = clinical specialty).
 * Used by the `specialties` lookup table and by any FHIR export that needs
 * to bind `EpisodeOfCare.type` to a bound value set.
 */
export const SPECIALTY_SNOMED: Record<SpecialtyType, string> = {
  mental_health: '394587001',
  general_medicine: '419192003',
  endocrinology: '394583002',
  paediatrics: '394537008',
  obstetrics_gynaecology: '394586005',
  surgery: '394609007',
  oncology: '394593009',
};

export const ALL_SPECIALTIES: SpecialtyType[] = SpecialtyTypeEnum.options;

/**
 * Shape returned by GET /staff/me.specialties and by GET /patients/:id/active-specialties.
 */
export const SpecialtyRefSchema = z.object({
  code: SpecialtyTypeEnum,
  display: z.string(),
  isPrimary: z.boolean().optional(),
});
export type SpecialtyRef = z.infer<typeof SpecialtyRefSchema>;

// apps/web/src/features/patients/types/patientTypes.ts
//
// Phase 0.7 PR3 Class D —
//  TYPEDUP:PatientFlagResponse: dropped the local PatientFlagSchema
//    (which had only 5 flagType values + 3 severities, did not match
//    backend reality). Re-exported from @signacare/shared which has the
//    real 9-category enum and 4-severity enum (low/medium/high/critical).
//    FlagBadge.tsx adjusted to handle 'critical'.
//
//  TYPEDUP:PatientTabId: shared declares PatientTabId as a bare
//    `string` (deeplink-stable). The frontend keeps the discriminated
//    union of known tab ids under the new name `KnownPatientTabId` so
//    components get autocomplete + exhaustiveness checking. Consumers
//    that only need a deeplink string can import shared `PatientTabId`.

export type { PatientFlagResponse, PatientTabId } from '@signacare/shared';
export { PatientFlagResponseSchema } from '@signacare/shared';

// ── Pagination ─────────────────────────────────────────────────────────────
// Uses `PaginatedResponse<T>` from `@signacare/shared` directly — the
// backend /patients list endpoint returns the canonical nested shape
// (data + pagination: { total, page, limit, totalPages }). Imported at
// call sites, not re-exported here, to avoid duplicate-api-types collision.

// ── Tabs ───────────────────────────────────────────────────────────────────
// `KnownPatientTabId` is the discriminated union of every tab the
// PatientDetailLayout currently mounts. Used internally for switch
// statements + autocomplete. The shared `PatientTabId` is the broader
// `string` type (re-exported above) for deeplink resolution where
// adding a new tab shouldn't require a shared package release.
export type KnownPatientTabId =
  | 'summary'
  | 'overview'
  | 'episodes'
  | 'documentation'
  | 'alerts-plans'
  | 'medications'
  | 'medication-history'
  | 'pathology'
  | 'physical-health'
  | 'legal'
  | 'referrals'
  | 'documents'
  | 'correspondence'
  | 'appointments'
  | 'assessments'
  | 'outcome-measures'
  | 'tracking'
  | '91day-review'
  | 'pathways'
  | 'lived-experience'
  | 'inpatient-care'
  | 'ect'
  | 'tms'
  | 'viva'
  | 'billing'
  | 'problems'
  | 'chronic-diseases'
  | 'glucose'
  | 'paediatrics'
  | 'obs-gyne'
  | 'surgery'
  | 'oncology'
  | 'onco-exchange'
  | 'mh-exchange'
  | 'gim-exchange'
  | 'endo-exchange'
  | 'paed-exchange'
  | 'obs-exchange'
  | 'surg-exchange';

export interface PatientTab {
  id: KnownPatientTabId;
  label: string;
}

export const PATIENT_TABS: PatientTab[] = [
  { id: 'summary',           label: 'Summary' },
  { id: 'overview',          label: 'Overview' },
  { id: 'episodes',          label: 'Episodes' },
  { id: 'documentation',     label: 'Documentation' },
  { id: 'alerts-plans',      label: 'Alerts & Plans' },
  { id: 'problems',          label: 'Problem List' },
  { id: 'chronic-diseases',  label: 'Internal Medicine' },
  { id: 'gim-exchange',      label: 'IM Information Exchange' },
  { id: 'glucose',           label: 'Endocrinology' },
  { id: 'endo-exchange',     label: 'Endo Information Exchange' },
  { id: 'paediatrics',       label: 'Paediatrics' },
  { id: 'paed-exchange',     label: 'Paed Information Exchange' },
  { id: 'obs-gyne',          label: 'Obstetrics & Gynaecology' },
  { id: 'obs-exchange',      label: 'Obs & Gyne Information Exchange' },
  { id: 'surgery',           label: 'Surgery' },
  { id: 'oncology',          label: 'Oncology' },
  { id: 'onco-exchange',     label: 'Oncology Information Exchange' },
  { id: 'surg-exchange',     label: 'Surgery Information Exchange' },
  { id: 'medications',       label: 'Active Medications' },
  { id: 'medication-history', label: 'Medication History' },
  { id: 'pathology',       label: 'Pathology' },
  { id: 'physical-health', label: 'Physical Health' },
  { id: 'legal',           label: 'Legal' },
  // Referrals / Correspondence / Documents are kept in the registry so
  // existing `?tab=` deeplinks still resolve, but they no longer appear
  // as top-level tabs. They're accessed via the nested Mental Health
  // Information Exchange wrapper below.
  { id: 'referrals',       label: 'Referrals' },
  { id: 'documents',       label: 'Documents' },
  { id: 'correspondence',  label: 'Correspondence' },
  { id: 'mh-exchange',     label: 'MH Information Exchange' },
  { id: 'assessments',     label: 'Rating Scales' },
  // Phase 8 separation refactor: outcome measures are now a dedicated
  // tab. The 'assessments' tab is the clinician-rated rating-scales
  // surface (heading inside the tab declares this explicitly); the
  // tab id is preserved so existing ?tab= deeplinks resolve.
  { id: 'outcome-measures', label: 'Outcome Measures' },
  { id: '91day-review',    label: '91-Day Review' },
  { id: 'pathways',          label: 'Psychology Pathways' },
  { id: 'lived-experience',  label: 'Lived Experience' },
  { id: 'tracking',          label: 'Tracking' },
  { id: 'inpatient-care',   label: 'Inpatient Care' },
  { id: 'ect',              label: 'ECT' },
  { id: 'tms',              label: 'TMS' },
  { id: 'appointments',    label: 'Appointments' },
  { id: 'viva',            label: 'Viva' },
  { id: 'billing',         label: 'Billing' },
];

// Grouped tabs for collapsible section display
export interface PatientTabGroup {
  label: string;
  tabs: KnownPatientTabId[];
}

export const DEFAULT_HIDDEN_PATIENT_TABS: readonly KnownPatientTabId[] = [
  'problems',
  'tracking',
  'billing',
  'inpatient-care',
  'ect',
  'tms',
];

export const PATIENT_TAB_GROUPS: PatientTabGroup[] = [
  // Snapshot is the at-a-glance, always-visible surface — common to
  // every specialty. Medications, Pathology, Physical Health and
  // Tracking sit here so the safety-critical reads (vitals, labs,
  // active meds, longitudinal observations) are one click away on
  // every chart, regardless of specialty enrolment.
  { label: 'Snapshot',            tabs: ['summary', 'alerts-plans', 'medications', 'medication-history', 'pathology', 'physical-health'] },
  { label: 'Internal Medicine',   tabs: ['chronic-diseases', 'gim-exchange'] },
  // Endocrinology keeps only the flowsheet — the insulin regimen now
  // lives as a sub-tab inside the Medications tab so all medication
  // workflows stay in one place.
  { label: 'Endocrinology',       tabs: ['glucose', 'endo-exchange'] },
  { label: 'Paediatrics',         tabs: ['paediatrics', 'paed-exchange'] },
  { label: 'Obstetrics & Gynaecology', tabs: ['obs-gyne', 'obs-exchange'] },
  { label: 'Surgery',             tabs: ['surgery', 'surg-exchange'] },
  { label: 'Oncology',            tabs: ['oncology', 'onco-exchange'] },
  // Mental Health owns episodes + assessments + the psychiatric
  // workflow tabs. Empty groups are dropped at render time, so a
  // non-MH clinician viewing a chart sees only the items they're
  // entitled to here (episodes + assessments are core/always-visible,
  // the rest are gated on the mental_health specialty enrolment).
  // Mental Health owns its psychiatric workflow tabs plus its own
  // nested Information Exchange wrapper (mh-exchange) which itself
  // contains Referrals / Correspondence / Documents as inner sub-tabs.
  { label: 'Mental Health',       tabs: ['documentation', 'assessments', 'outcome-measures', '91day-review', 'pathways', 'lived-experience', 'mh-exchange'] },
  // Viva is the patient-facing app — available to every specialty,
  // not psychiatry-specific.
  { label: 'Patient App',          tabs: ['viva'] },
  { label: 'Governance',          tabs: ['legal'] },
  { label: 'Admin',               tabs: ['overview', 'episodes', 'appointments', 'billing', 'problems', 'tracking', 'inpatient-care', 'ect', 'tms'] },
];

export function calculateAge(dob: string): number {
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

// ── Registration Wizard ────────────────────────────────────────────────────

export interface SupportPerson {
  id: string;
  givenName: string;
  familyName: string;
  relationship: string;
  phoneMobile: string;
  phoneHome: string;
  email: string;
  consentLevel: 'emergency_only' | 'partial' | 'full' | '';
  consentNotes: string;
  isEmergencyContact: boolean;
  isCarer: boolean;
}

export interface FundingSource {
  id: string;
  type: string;
  details: string;
  expiryDate: string;
  isPrimary: boolean;
}

export interface PatientProvider {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  practiceName: string;
  addressStreet: string;
  addressSuburb: string;
  addressState: string;
  addressPostcode: string;
  phone: string;
  email: string;
  providerNumber: string;
}

export interface RegistrationAttachment {
  id: string;
  file: File;
  label: string;
}

export interface RegistrationWizardData {
  // Step 1 — Demographics
  givenName: string;
  familyName: string;
  preferredName?: string;
  dateOfBirth: string;
  gender?: string;
  pronouns?: string;
  atsiStatus?: string;
  // Legacy alias for atsiStatus — some step forms bound to
  // `indigenousStatus` before the field was canonicalised. Carried
  // forward so existing Formik bindings continue to round-trip.
  indigenousStatus?: string;
  interpreterRequired: boolean;
  interpreterLanguage?: string;
  interpreterLanguageOther?: string;
  phoneMobile?: string;
  phoneHome?: string;
  // Audit Tier 9.3 — additional contact fields read by the wizard's
  // final DTO build step. Previously accessed via `(values as any).X`;
  // adding them to the interface removes the cast while keeping all
  // fields optional (the wizard doesn't require them to submit).
  emailPrimary?: string;
  addressStreet?: string;
  addressSuburb?: string;
  addressState?: string;
  addressPostcode?: string;
  // GP / provider shortcuts (Step 7)
  gpName?: string;
  gpPractice?: string;
  gpPhone?: string;
  gpEmail?: string;
  gpProviderNumber?: string;
  // Next-of-kin shortcuts (Step 6)
  nokName?: string;
  nokRelationship?: string;
  nokPhone?: string;
  localUrNumber?: string;
  statewideUrNumber?: string;
  // Step 2 — Identifiers
  medicareNumber?: string;
  medicareReference?: string;
  medicareExpiry?: string;
  ihiNumber?: string;
  dvaNumber?: string;
  dvaCardType?: 'gold' | 'white' | 'orange';
  dvaExpiry?: string;
  healthcareCardNumber?: string;
  healthcareCardExpiry?: string;
  pensionCardNumber?: string;
  pensionCardExpiry?: string;
  mrn?: string;
  // Step 3 — Funding
  fundingSources: FundingSource[];
  // Step 4 — Support Persons
  supportPersons: SupportPerson[];
  // Step 5 — Providers
  providers: PatientProvider[];
  // Step 4b — Health Conditions
  healthConditions: string[];
  // Step 5b — Medications
  medications: { medicationName: string; dose: string; frequency: string; prescriber: string }[];
  // Step 6 — Attachments
  attachments: RegistrationAttachment[];
  // Step 7 — Consent
  consentToTreatment: boolean;
  consentForResearch: boolean;
  myHealthRecordOptOut: boolean;
  // Additional consent flags the final step toggles individually.
  consentToShareWithGp?: boolean;
  consentToShareWithCarer?: boolean;
}

export const WIZARD_DEFAULT_DATA: RegistrationWizardData = {
  givenName: '',
  familyName: '',
  dateOfBirth: '',
  interpreterRequired: false,
  fundingSources: [],
  supportPersons: [],
  providers: [],
  healthConditions: [],
  medications: [],
  attachments: [],
  consentToTreatment: false,
  consentForResearch: false,
  consentToShareWithGp: false,
  consentToShareWithCarer: false,
  myHealthRecordOptOut: false,
};

// ── Health Conditions (common in MH settings) ──────────────────────────────
export const HEALTH_CONDITIONS_LIST = [
  'Schizophrenia', 'Schizoaffective Disorder', 'Bipolar Disorder', 'Major Depressive Disorder',
  'Generalised Anxiety Disorder', 'PTSD', 'Borderline Personality Disorder', 'OCD',
  'Eating Disorder', 'ADHD', 'Autism Spectrum Disorder', 'Intellectual Disability',
  'Substance Use Disorder', 'Alcohol Use Disorder', 'Diabetes', 'Hypertension',
  'Hyperlipidaemia', 'Obesity / Metabolic Syndrome', 'Hypothyroidism', 'Epilepsy',
  'Chronic Pain', 'Asthma / COPD', 'Hepatitis C', 'HIV', 'Cardiac Condition', 'Renal Impairment',
];

// ── Interpreter languages (Australian context) ────────────────────────────
export const INTERPRETER_LANGUAGES = [
  'Mandarin', 'Cantonese', 'Vietnamese', 'Arabic', 'Greek', 'Italian',
  'Turkish', 'Filipino/Tagalog', 'Hindi', 'Spanish', 'Korean', 'Punjabi',
  'Dari', 'Persian/Farsi', 'Sinhalese', 'Tamil', 'Samoan', 'Thai',
  'Indonesian/Malay', 'Burmese', 'Khmer', 'Dinka', 'Swahili', 'Amharic',
  'Somali', 'Assyrian/Chaldean', 'Auslan (Sign Language)', 'Other',
];

// ── Support Person relationships (Australian MH context) ─────────────────
export const SUPPORT_RELATIONSHIPS = [
  'Parent', 'Spouse / Partner', 'Child (Adult)', 'Sibling', 'Grandparent',
  'Other Family Member', 'Friend', 'Guardian', 'Financial Administrator',
  'Carer', 'Support Worker', 'Disability Support Worker', 'NDIS Support Coordinator',
  'Case Manager (External)', 'Nominated Person (MH Act)', 'Legal Representative',
  'Other',
];

// ── Funding types (Australian context) ───────────────────────────────────
export const FUNDING_TYPES = [
  { value: 'medicare',     label: 'Medicare (Bulk Bill)' },
  { value: 'dva',          label: 'DVA' },
  { value: 'private',      label: 'Private Health Insurance' },
  { value: 'ndis',         label: 'NDIS' },
  { value: 'tac',          label: 'TAC (Transport Accident Commission)' },
  { value: 'workcover',    label: 'WorkCover' },
  { value: 'selfpay',      label: 'Self Pay' },
  { value: 'public',       label: 'Public (State-funded)' },
  { value: 'other',        label: 'Other' },
];

// ── Provider roles (Australian health / MH context) ──────────────────────
export const PROVIDER_ROLES = [
  'General Practitioner', 'Psychiatrist', 'Psychiatry Registrar',
  'Psychologist', 'Clinical Psychologist', 'Neuropsychologist',
  'Social Worker', 'Occupational Therapist', 'Mental Health Nurse',
  'Speech Pathologist', 'Dietitian', 'Exercise Physiologist',
  'Pharmacist', 'Paediatrician', 'Neurologist', 'Endocrinologist',
  'Cardiologist', 'Obstetrician/Gynaecologist', 'Pain Specialist',
  'Addiction Medicine Specialist', 'Geriatrician', 'Rehabilitation Physician',
  'Dental Practitioner', 'Optometrist', 'Physiotherapist',
  'Aboriginal Health Worker', 'Other',
];

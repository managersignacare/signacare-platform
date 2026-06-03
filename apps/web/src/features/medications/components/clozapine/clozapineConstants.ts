// apps/web/src/features/medications/components/clozapine/clozapineConstants.ts
//
// BUG-607 — clozapine NIMC clinical-safety constants extracted from
// ClozapinePanel.tsx (was L48-141; ~95 LOC) per the inner-tab split
// plan. These are the canonical clinical-safety primitives that drive
// the 8 inner-tab panels:
//
//   - NIMC_TITRATION_SCHEDULE: 14-day titration ramp-up doses
//   - ANC_THRESHOLDS: blood traffic-light (green/amber/red) — RED is
//     the agranulocytosis fatality-prevention "STOP clozapine" action
//   - NON_ADMIN_CODES: 8 AHPRA-required non-administration codes
//     (A/F/R/V/L/N/W/S)
//   - MONITORING_INVESTIGATIONS: 25-row NIMC monitoring checklist
//   - ADVERSE_EFFECTS: 12-row adverse-effects reference (3 fatal:
//     agranulocytosis, myocarditis/cardiomyopathy, severe CIGH)
//   - PRE_COMMENCEMENT_ITEMS: 10-item pre-commencement checklist
//   - ancColor: traffic-light hex helper consumed by the registration
//     summary chip + blood-results table cell colouring
//
// Byte-faithful extraction (clinical-safety primitive). Verified by
// L4 reviewer against NIMC source pages.

export type ClozapineInnerTab =
  | 'overview'
  | 'titration'
  | 'blood'
  | 'administration'
  | 'observations'
  | 'monitoring'
  | 'adverse'
  | 'precommencement';

// NIMC suggested titration schedule (guide only — 14 days)
export const NIMC_TITRATION_SCHEDULE = [
  { day: 1,  morning: 12.5, evening: 0 },
  { day: 2,  morning: 25,   evening: 0 },
  { day: 3,  morning: 25,   evening: 25 },
  { day: 4,  morning: 25,   evening: 25 },
  { day: 5,  morning: 25,   evening: 50 },
  { day: 6,  morning: 25,   evening: 75 },
  { day: 7,  morning: 25,   evening: 100 },
  { day: 8,  morning: 25,   evening: 100 },
  { day: 9,  morning: 50,   evening: 100 },
  { day: 10, morning: 50,   evening: 125 },
  { day: 11, morning: 50,   evening: 125 },
  { day: 12, morning: 50,   evening: 125 },
  { day: 13, morning: 50,   evening: 125 },
  { day: 14, morning: 50,   evening: 150 },
];

// Blood results traffic light (NIMC p.14)
export const ANC_THRESHOLDS = {
  green: { label: 'Green', wbc: 3.5, neutrophils: 2.0, color: '#2E7D32', bg: '#E8F5E9', action: 'Continue clozapine therapy' },
  amber: { label: 'Amber', wbc: 3.0, neutrophils: 1.5, color: '#E65100', bg: '#FFF3E0', action: 'Continue with twice-weekly blood tests until return to green range' },
  red:   { label: 'Red',   wbc: 0,   neutrophils: 0,   color: '#C62828', bg: '#FFEBEE', action: 'STOP clozapine immediately. Refer to local clozapine protocol' },
};

// Non-administration codes (NIMC p.12)
export const NON_ADMIN_CODES = [
  { code: 'A', label: 'Absent' },
  { code: 'F', label: 'Fasting' },
  { code: 'R', label: 'Refused — notify prescriber' },
  { code: 'V', label: 'Vomiting' },
  { code: 'L', label: 'On leave' },
  { code: 'N', label: 'Not available — obtain supply or contact prescriber' },
  { code: 'W', label: 'Withheld — enter reason in clinical record' },
  { code: 'S', label: 'Self administered' },
];

// NIMC monitoring investigations checklist (p.19)
export const MONITORING_INVESTIGATIONS = [
  { name: 'Full blood count (FBC)', after28: 'Weekly 18wk then monthly' },
  { name: 'White blood cell (WBC)', after28: 'Weekly 18wk then monthly' },
  { name: 'Neutrophils', after28: 'Weekly 18wk then monthly' },
  { name: 'Eosinophils', after28: 'Weekly 18wk then monthly' },
  { name: 'Troponin', after28: 'At 6wk, 3mo, then per protocol' },
  { name: 'C-reactive protein (CRP)', after28: 'At 6wk, 3mo, then per protocol' },
  { name: 'ECG', after28: 'Then per local protocol' },
  { name: 'Liver function test (LFT)', after28: 'Then per local protocol' },
  { name: 'Urea and electrolytes (U&E)', after28: 'Then per local protocol' },
  { name: 'Blood group', after28: '' },
  { name: 'Plasma glucose — fasting', after28: 'At 3mo then every 6mo' },
  { name: 'Total cholesterol — fasting', after28: 'At 3mo then every 6mo' },
  { name: 'LDL — fasting', after28: 'At 3mo then every 6mo' },
  { name: 'HDL — fasting', after28: 'At 3mo then every 6mo' },
  { name: 'Triglycerides — fasting', after28: 'At 3mo then every 6mo' },
  { name: 'Beta HCG (female)', after28: 'As required' },
  { name: 'Cardiac ECHO', after28: 'Then per local protocol' },
  { name: 'Clozapine level', after28: 'Then per local protocol' },
  { name: 'Full physical exam', after28: '' },
  { name: 'Height', after28: '' },
  { name: 'Weight', after28: 'Then continue monthly' },
  { name: 'Waist', after28: 'Then continue monthly' },
  { name: 'BMI', after28: 'Then continue monthly' },
  { name: 'Constipation', after28: 'Continue weekly' },
  { name: 'Smoking — cigarettes per day', after28: 'As required' },
];

// Adverse effects reference (NIMC p.17)
export const ADVERSE_EFFECTS = [
  { effect: 'Neutropenia / Agranulocytosis', onset: 'First 18 weeks (may occur any time)', action: 'Refer to blood results monitoring table. Admit if agranulocytosis confirmed.' },
  { effect: 'Myocarditis / Cardiomyopathy', onset: 'Myocarditis: 6–8 weeks. Cardiomyopathy: any time', action: 'Cease clozapine. Admit to hospital if confirmed. May present with flu-like symptoms.' },
  { effect: 'Constipation (CIGH)', onset: 'Persistent; requires continuous monitoring', action: 'Severe CIGH can be fatal. High-fibre diet, fluids, laxatives (docusate/senna/macrogol).' },
  { effect: 'Sedation', onset: 'First few months', action: 'Give smaller dose in morning. Reduce dose if necessary. Check plasma level.' },
  { effect: 'Hypersalivation', onset: 'First few months, worse at night', action: 'Manage according to severity. See pharmacological options.' },
  { effect: 'Hypotension', onset: 'First 4 weeks', action: 'Reduce dose or slow rate of increase. Stand up from lying/sitting slowly.' },
  { effect: 'Tachycardia', onset: 'First 4 weeks, sometimes persists', action: 'Common early. If persistent at rest with chest pain or hypotension, refer to cardiologist.' },
  { effect: 'Weight gain', onset: 'Usually during first year', action: 'Dietary counselling before weight gain occurs.' },
  { effect: 'Fever', onset: 'First 4 weeks', action: 'Antipyretic, perform urgent FBC and cardiac enzymes. Seek urgent medical review.' },
  { effect: 'Seizures', onset: 'May occur at any time', action: 'Check clozapine levels, neurology consult, EEG. Consider anti-seizure medication.' },
  { effect: 'Nausea', onset: 'First 6 weeks', action: 'Anti-emetic. Avoid prochlorperazine and metoclopramide. Consider GORD.' },
  { effect: 'Nocturnal enuresis', onset: 'May occur at any time', action: 'Review dose schedule. Avoid fluids before bedtime. Seek medical review.' },
];

// Pre-commencement checklist (NIMC p.15)
export const PRE_COMMENCEMENT_ITEMS = [
  'Assess current smoking status',
  'Review and document medical history, cardio-metabolic risk factors and drug interactions',
  'Assess bowel habits including presence of anticholinergic or constipating agents',
  'Provide and explain clozapine brochure to consumer and family/carer',
  'Complete clozapine patient registration form and send to Clozapine Monitoring Centre',
  'Inform your local clozapine coordinator',
  'Provide pharmacist with blood test results and prescription',
  'Complete high cost eligibility form',
  'Complete clozapine baseline monitoring (see investigations checklist)',
  'Obtain Clozapine Patient Number (CPN) before prescribing',
];

// ANC traffic-light hex helper. Used by the registration summary chip
// + blood-results table row colouring. ANC status comes from the
// `anc_status` enum: 'normal' | 'amber' | 'red' | 'unknown'.
export function ancColor(status: string | null | undefined): string {
  if (status === 'red') return '#C62828';
  if (status === 'amber') return '#E65100';
  if (status === 'normal') return '#2E7D32';
  return '#9E9E9E';
}

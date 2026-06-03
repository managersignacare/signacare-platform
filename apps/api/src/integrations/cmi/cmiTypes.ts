/**
 * Victorian CMI (Client Management Interface) Data Types
 *
 * Based on Department of Health Victoria mental health data collection requirements.
 * NOCC (National Outcomes and Casemix Collection) framework.
 *
 * Key datasets:
 * - Episode data (admissions, transfers, discharges)
 * - Service contacts (clinical encounters, ABF contact events)
 * - Outcome measures (HoNOS, LSP, K10+, BASIS-32)
 * - Legal status (MHA orders, tribunal outcomes)
 * - Seclusion & restraint events
 *
 * Reference: https://www.health.vic.gov.au/mental-health-services/data-collection
 */

// ── Episode Collection ──

export interface CmiEpisodeRecord {
  orgCode: string;                    // Organisation code (CMI registered)
  clientId: string;                   // Patient UR number
  episodeId: string;                  // Internal episode ID
  episodeType: CmiEpisodeType;
  settingType: CmiSettingType;
  startDate: string;                  // YYYY-MM-DD
  endDate?: string;
  principalDiagnosis: string;         // ICD-10-AM code
  additionalDiagnoses?: string[];     // Up to 9 additional
  mentalHealthLegalStatus: CmiLegalStatus;
  referralSource: string;             // CMI referral source code
  separationMode?: CmiSeparationMode; // Discharge mode
  teamCode: string;                   // Service unit/team code
}

export type CmiEpisodeType =
  | 'inpatient'
  | 'residential'
  | 'ambulatory'           // Community / outpatient
  | 'day_program';

export type CmiSettingType =
  | 'acute_inpatient'
  | 'sub_acute'
  | 'residential'
  | 'community_care'
  | 'consultation_liaison'
  | 'mobile_support'       // CATT, ACIS
  | 'day_program'
  | 'outpatient';

export type CmiLegalStatus =
  | 'voluntary'
  | 'involuntary_assessment'    // Assessment Order s29
  | 'involuntary_treatment'     // Treatment Order s55
  | 'temporary_treatment'       // TTO s45
  | 'court_order'               // Court Assessment Order s30
  | 'security_patient'
  | 'forensic_patient';

export type CmiSeparationMode =
  | 'to_usual_residence'
  | 'transfer_other_mh'
  | 'transfer_acute_hospital'
  | 'transfer_residential'
  | 'left_against_advice'
  | 'absconded'
  | 'died'
  | 'other';

// ── Service Contact Collection ──

export interface CmiServiceContact {
  orgCode: string;
  clientId: string;
  contactDate: string;                // YYYY-MM-DD
  contactType: CmiContactType;
  duration: number;                   // minutes
  participationType: CmiParticipationType;
  clinicianCategory: CmiClinicianCategory;
  serviceContactModality: CmiContactModality;
  didNotAttend: boolean;
  teamCode: string;
  mbsItemNumber?: string;            // Medicare billing item
  abfContactType?: string;           // Activity Based Funding category
}

export type CmiContactType =
  | 'assessment'
  | 'review'
  | 'therapy_individual'
  | 'therapy_group'
  | 'medication_management'
  | 'care_coordination'
  | 'family_carer'
  | 'consultation'
  | 'crisis_intervention'
  | 'community_treatment'
  | 'telephone'
  | 'telehealth';

export type CmiParticipationType =
  | 'individual'
  | 'group'
  | 'family'
  | 'carer'
  | 'collateral'           // With other services
  | 'non_direct';          // Admin, planning

export type CmiClinicianCategory =
  | 'psychiatrist'
  | 'registrar'
  | 'gp'
  | 'nurse'
  | 'psychologist'
  | 'social_worker'
  | 'occupational_therapist'
  | 'peer_worker'
  | 'other';

export type CmiContactModality =
  | 'face_to_face'
  | 'telephone'
  | 'video_telehealth'
  | 'written';

// ── Outcome Measures (NOCC / MH-OAT) ──

export interface CmiOutcomeMeasure {
  orgCode: string;
  clientId: string;
  episodeId: string;
  collectionOccasion: CmiCollectionOccasion;
  collectionDate: string;
  measureType: CmiMeasureType;
  scores: Record<string, number>;     // Item scores
  totalScore?: number;
  raterType: 'clinician' | 'consumer' | 'carer';
}

export type CmiCollectionOccasion =
  | 'admission'
  | '91_day_review'
  | 'discharge'
  | 'review'
  | 'referral';

export type CmiMeasureType =
  | 'honos'          // Health of the Nation Outcome Scales (12 items, clinician-rated)
  | 'honos_65plus'   // HoNOS 65+ for older adults
  | 'honosca'        // HoNOS Children & Adolescents
  | 'lsp16'          // Life Skills Profile (16 items, clinician-rated)
  | 'k10plus'        // Kessler 10+ (consumer-rated, 14 items)
  | 'basis32'        // Behaviour and Symptom Identification Scale
  | 'sdq'            // Strengths and Difficulties Questionnaire (child/adolescent)
  | 'phoqol'         // Perceived Health of Queensland Quality of Life
  | 'whoqol_bref';   // WHO Quality of Life Brief

// ── HoNOS Specific (most common) ──

export interface HonosScores {
  overactiveAggressive: number;       // 0-4
  selfHarm: number;                   // 0-4
  substanceUse: number;               // 0-4
  cognitiveProblems: number;          // 0-4
  physicalIllness: number;            // 0-4
  hallucinationsDelusions: number;    // 0-4
  depressedMood: number;              // 0-4
  otherMentalProblems: number;        // 0-4
  relationships: number;              // 0-4
  adl: number;                        // 0-4 (Activities of Daily Living)
  livingConditions: number;           // 0-4
  occupation: number;                 // 0-4
}

// ── K10+ Specific ──

export interface K10PlusScores {
  nervous: number;                    // 1-5
  hopeless: number;
  restless: number;
  depressed: number;
  effortless: number;
  worthless: number;
  anxious: number;
  cantCheerUp: number;
  sad: number;
  soNervous: number;
  // Plus items
  daysUnableToWork: number;           // 0-28
  daysReducedActivity: number;        // 0-28
  consultedHealth: number;            // 0=no, 1=yes
  consultedMentalHealth: number;      // 0=no, 1=yes
}

// ── Seclusion & Restraint (mandatory reporting) ──

export interface CmiSeclusionRestraintEvent {
  orgCode: string;
  clientId: string;
  eventType: 'seclusion' | 'mechanical_restraint' | 'physical_restraint' | 'chemical_restraint';
  startDateTime: string;
  endDateTime: string;
  durationMinutes: number;
  reason: string;
  authorisedBy: string;               // Clinician name
  reviewConducted: boolean;
  debriefConducted: boolean;
  bodyWornCamera: boolean;
}

// ── Submission ──

export interface CmiSubmissionPayload {
  orgCode: string;
  submissionPeriod: string;           // e.g. "2026-Q1"
  submissionType: 'full' | 'incremental' | 'correction';
  episodes: CmiEpisodeRecord[];
  contacts: CmiServiceContact[];
  outcomes: CmiOutcomeMeasure[];
  seclusionRestraint: CmiSeclusionRestraintEvent[];
}

export interface CmiSubmissionResult {
  success: boolean;
  submissionId?: string;
  recordsAccepted: number;
  recordsRejected: number;
  validationErrors: { recordType: string; field: string; message: string }[];
  timestamp: string;
}

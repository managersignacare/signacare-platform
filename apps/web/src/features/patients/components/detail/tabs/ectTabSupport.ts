export type JsonRecord = Record<string, unknown>;
export type ApiListEnvelope<T> = T[] | { data?: T[] };

export interface StaffPrescriberRow {
  prescriberNumber?: string | null;
  prescriber_number?: string | null;
}

export interface NursingAssessmentRow {
  id?: string;
  assessmentDatetime?: string;
  createdAt?: string;
  assessmentData?: JsonRecord;
  scores?: JsonRecord;
}

export interface NursingAssessmentsResponse {
  data?: NursingAssessmentRow[];
}

export interface EctCourseData extends JsonRecord {
  indication?: string;
  status?: string;
  totalTreatments?: number | string;
  plannedTreatments?: number | string;
  electrodePlacement?: string;
  frequency?: string;
  anaesthetist?: string;
}

export interface EctTreatmentData extends JsonRecord {
  treatmentNumber?: number | string;
  treatmentDate?: string;
  electrodePlacement?: string;
  charge?: number | string;
  seizureDurationMotor?: number | string;
  seizureDurationEeg?: number | string;
  adequateSeizure?: boolean;
  anaestheticAgent?: string;
  anaestheticDose?: number | string;
  headache?: boolean;
  nausea?: boolean;
  confusion?: boolean;
  memoryIssues?: boolean;
}

export interface EctAssessmentHistoryData extends JsonRecord {
  treatmentNumber?: number | string;
  assessmentDate?: string;
  date?: string;
  mmseScore?: number | string;
  mocaScore?: number | string;
  reorientationTime?: number | string;
  memoryComplaints?: string;
  retrogradeAmnesia?: boolean;
  anterogradeAmnesia?: boolean;
  cognitiveImpact?: string;
  notes?: string;
}

export interface EctMedicalForm {
  phase: string;
  treatmentNumber: string;
  date: string;
  clinicalPresentation: string;
  mseFindings: string;
  riskAssessment: string;
  treatmentResponse: string;
  sideEffects: string;
  planChanges: string;
  madrsScore: string;
  hamdScore: string;
  bprsScore: string;
  cgiSeverity: string;
  cgiImprovement: string;
  notes: string;
}

export const MEDICAL_SCORE_FIELDS = [
  { key: 'madrsScore', label: 'MADRS' },
  { key: 'hamdScore', label: 'HAM-D' },
  { key: 'bprsScore', label: 'BPRS' },
  { key: 'cgiSeverity', label: 'CGI-S' },
  { key: 'cgiImprovement', label: 'CGI-I' },
] as const satisfies ReadonlyArray<{ key: keyof EctMedicalForm; label: string }>;

export interface EctDocumentRow {
  id?: string;
  title?: string;
  name?: string;
  fileName?: string;
  documentType?: string;
  document_type?: string;
  category?: string;
  createdAt?: string;
  uploadedAt?: string;
}

export interface EctDocumentsResponse {
  data?: EctDocumentRow[];
}

export interface ClinicalAiResponse {
  result?: string;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null;
}

export function readList<T>(payload: ApiListEnvelope<T> | undefined | null): T[] {
  if (Array.isArray(payload)) return payload;
  if (payload && isRecord(payload) && Array.isArray(payload.data)) return payload.data as T[];
  return [];
}

export function readAssessmentData<T extends JsonRecord>(row: NursingAssessmentRow | undefined): T {
  if (!row) return {} as T;
  if (isRecord(row.assessmentData) && Object.keys(row.assessmentData).length > 0) return row.assessmentData as T;
  if (isRecord(row.scores)) return row.scores as T;
  return {} as T;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && isRecord(error.response) && isRecord(error.response.data) && typeof error.response.data.error === 'string') {
    return error.response.data.error;
  }
  return 'Unknown error';
}

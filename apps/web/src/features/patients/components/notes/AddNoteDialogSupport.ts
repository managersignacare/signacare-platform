export type TemplateField = {
  type?: string;
  text?: string;
  label?: string;
  options?: string[];
  min?: number;
  max?: number;
};

export interface Template {
  id: string;
  name: string;
  type: string;
  categoryName?: string;
  content: TemplateField[];
}

export type EpisodeOption = {
  id: string;
  status?: string;
  title?: string;
  episodeType?: string;
};

export type PatientLetterProfile = {
  givenName?: string;
  given_name?: string;
  familyName?: string;
  family_name?: string;
  dateOfBirth?: string;
  date_of_birth?: string;
  emrNumber?: string;
  emr_number?: string;
  email?: string;
  emailPrimary?: string;
  email_primary?: string;
  emergencyContactName?: string;
  emergency_contact_name?: string;
  nokName?: string;
  nok_name?: string;
};

export type MedicationLetterRow = {
  status?: string;
  medicationName?: string;
  drug_label?: string;
  dose?: string;
  frequency?: string;
};

export type DiagnosisLetterRow = {
  description?: string;
  name?: string;
};

export type ClinicLetterProfile = {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
};

export type ProviderLetterRow = {
  providerType?: string;
  provider_type?: string;
  name?: string;
  providerName?: string;
  provider_name?: string;
  email?: string;
  providerEmail?: string;
  provider_email?: string;
};

export type LetterDataResponse = {
  patient: PatientLetterProfile | null;
  medications: MedicationLetterRow[];
  diagnoses: DiagnosisLetterRow[];
  clinic: ClinicLetterProfile | null;
  providers: ProviderLetterRow[];
};

export type LlmLetterResponse = {
  result?: string;
};

export type NoteCreateResponse = {
  note?: { id?: string };
  id?: string;
};

export const getErrorMessage = (err: unknown, fallback: string): string => {
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof (err as { message?: unknown }).message === 'string'
  ) {
    return (err as { message: string }).message;
  }
  return fallback;
};

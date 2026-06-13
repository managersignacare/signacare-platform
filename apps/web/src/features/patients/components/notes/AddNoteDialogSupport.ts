import type {
  TemplateResponse,
  TemplateSectionResponse,
} from '../../../templates/types/templateTypes';

export type Template = TemplateResponse;

export function templateSectionsToDraftText(sections: TemplateSectionResponse[]): string {
  return sections.map((section) => {
    switch (section.fieldType) {
      case 'heading':
        return `\n=== ${section.label} ===\n`;
      case 'text':
        return section.soapField
          ? `${section.label}:\n\n`
          : `${section.label}${section.placeholder ? ` — ${section.placeholder}` : ''}\n\n`;
      case 'yes_no':
        return `${section.label}: [ ] Yes  [ ] No\n`;
      case 'single_select':
        return `${section.label}: ${(section.options ?? []).map((option) => `[ ] ${option.label}`).join('  ')}\n`;
      case 'multi_select':
        return `${section.label}: ${(section.options ?? []).map((option) => `[ ] ${option.label}`).join('  ')}\n`;
      case 'likert':
        return `${section.label}: [${section.minValue ?? 0}-${section.maxValue ?? 5}]\n`;
      case 'numeric':
        return `${section.label}: ____\n`;
      case 'date':
        return `${section.label}: ____ / ____ / ________\n`;
      default:
        return '';
    }
  }).join('');
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

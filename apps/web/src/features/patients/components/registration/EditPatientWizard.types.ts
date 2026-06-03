import type { FundingSource, PatientProvider } from '../../types/patientTypes';

export interface SupportPerson {
  _id: string;
  _existingId?: string;
  givenName: string;
  familyName: string;
  relationship: string;
  phoneMobile: string;
  phoneHome: string;
  email: string;
  isEmergencyContact: boolean;
  isCarer: boolean;
  hasConsent: boolean;
  consentLevel: 'full' | 'emergency_only' | 'partial' | '';
  consentNotes: string;
}

export interface EditPatientFormData {
  // Demographics
  givenName: string;
  familyName: string;
  preferredName: string;
  dateOfBirth: string;
  gender: string;
  pronouns: string;
  atsiStatus: string;
  interpreterRequired: boolean;
  interpreterLanguage: string;
  // Contact & Address
  phoneMobile: string;
  phoneHome: string;
  emailPrimary: string;
  addressStreet: string;
  addressSuburb: string;
  addressState: string;
  addressPostcode: string;
  // Identifiers
  medicareNumber: string;
  medicareIrn: string;
  medicareExpiry: string;
  ihi: string;
  dvaNumber: string;
  dvaCardType: string;
  // Support Persons
  supportPersons: SupportPerson[];
  providers: PatientProvider[];
  // Providers
  gpName: string;
  gpPractice: string;
  gpProviderNumber: string;
  gpPhone: string;
  gpEmail: string;
  gpFax: string;
  gpAddressStreet: string;
  gpAddressSuburb: string;
  gpAddressState: string;
  gpAddressPostcode: string;
  // Next of Kin
  nokName: string;
  nokRelationship: string;
  nokPhone: string;
  // Funding
  healthFundName: string;
  healthFundNumber: string;
  fundingSources: FundingSource[];
  // Consent
  consentToTreatment: boolean;
  consentForResearch: boolean;
  consentToShareWithGp: boolean;
  consentToShareWithCarer: boolean;
}

export type ContactRecord = {
  id: string;
  givenName?: string;
  familyName?: string;
  relationship?: string;
  phoneMobile?: string;
  phoneHome?: string;
  email?: string;
  isEmergencyContact?: boolean;
  isCarer?: boolean;
  hasConsent?: boolean;
  consentLevel?: SupportPerson['consentLevel'];
  consentNotes?: string;
};

export type ProviderRecord = {
  id: string;
  providerType?: string;
  providerName?: string;
  providerPractice?: string;
  providerPhone?: string;
  providerEmail?: string;
  providerNumber?: string;
  providerAddress?: string;
  isPrimary?: boolean;
};

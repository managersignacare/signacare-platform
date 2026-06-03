import { z } from 'zod';

export const CreateAdmissionWaitlistSchema = z.object({
  hotspotId: z.string().uuid().optional(),
  reason: z.string().min(1).max(2000),
  priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'),
  preferredWard: z.string().max(200).optional(),
  targetAdmissionDate: z.string().optional(),
  clinicalNotes: z.string().max(5000).optional(),
  episodeId: z.string().uuid().optional(),
});
export type CreateAdmissionWaitlistDTO = z.infer<typeof CreateAdmissionWaitlistSchema>;

export const UpdateAdmissionWaitlistSchema = z.object({
  priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
  reason: z.string().max(2000).optional(),
  clinicalNotes: z.string().max(5000).optional(),
  preferredWard: z.string().max(200).optional(),
  targetAdmissionDate: z.string().optional(),
});
export type UpdateAdmissionWaitlistDTO = z.infer<typeof UpdateAdmissionWaitlistSchema>;

export const RemoveFromWaitlistSchema = z.object({
  removalReason: z.string().max(2000).optional(),
});
export type RemoveFromWaitlistDTO = z.infer<typeof RemoveFromWaitlistSchema>;

export const CreatePatientAlertSchema = z.object({
  alertTypeId: z.string().uuid(),
  title: z.string().min(1).max(500),
  notes: z.string().max(5000).optional(),
  managementPlan: z.string().max(10000).optional(),
  severity: z.string().max(30).optional(),
  showFlag: z.boolean().optional(),
});
export type CreatePatientAlertDTO = z.infer<typeof CreatePatientAlertSchema>;

export const UpdatePatientAlertSchema = z.object({
  title: z.string().max(500).optional(),
  notes: z.string().max(5000).optional(),
  managementPlan: z.string().max(10000).optional(),
  isActive: z.boolean().optional(),
  showFlag: z.boolean().optional(),
});
export type UpdatePatientAlertDTO = z.infer<typeof UpdatePatientAlertSchema>;

export const CreateHotspotSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type CreateHotspotDTO = z.infer<typeof CreateHotspotSchema>;

export const CreatePatientContactSchema = z.object({
  contactType: z.string().max(50).nullish(),
  // DB contract: patient_contacts.given_name/family_name are varchar(100)
  givenName: z.string().min(1).max(100),
  familyName: z.string().min(1).max(100),
  relationship: z.string().max(100).nullish(),
  phoneMobile: z.string().max(30).nullish(),
  phoneHome: z.string().max(30).nullish(),
  email: z.union([z.string().email(), z.literal('')]).nullish(),
  isEmergencyContact: z.boolean().optional(),
  isCarer: z.boolean().optional(),
  hasConsent: z.boolean().optional(),
  consentLevel: z.string().max(50).nullish(),
  consentNotes: z.string().max(2000).nullish(),
});
export type CreatePatientContactDTO = z.infer<typeof CreatePatientContactSchema>;

export const CreatePatientProviderSchema = z.object({
  providerType: z.string().max(100).nullish(),
  // DB contract: patient_providers.provider_name/practice are varchar(200)
  providerName: z.string().min(1).max(200),
  providerPractice: z.string().max(200).nullish(),
  providerPhone: z.string().max(30).nullish(),
  providerFax: z.string().max(30).nullish(),
  providerEmail: z.union([z.string().email(), z.literal('')]).nullish(),
  // DB contract: patient_providers.provider_number is varchar(30)
  providerNumber: z.string().max(30).nullish(),
  providerAddress: z.string().max(500).nullish(),
  isPrimary: z.boolean().optional(),
});
export type CreatePatientProviderDTO = z.infer<typeof CreatePatientProviderSchema>;

import { z } from 'zod';
import { SpecialtyTypeEnum } from './specialty.schemas';

export const ClinicTypeEnum = z.enum(['solo_practice', 'group_practice', 'hospital']);
const HPIO_FORMAT = /^800362\d{10}$/;
const HPIO_SEPARATORS = /[\s-]+/g;

export const ProvisionClinicSchema = z.object({
  // Step 1: Clinic details
  clinicName: z.string().min(1).max(255),
  legalName: z.string().max(255).optional(),
  abn: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  addressStreet: z.string().max(255).optional(),
  addressSuburb: z.string().max(100).optional(),
  addressState: z.string().max(20).optional(),
  addressPostcode: z.string().max(10).optional(),
  timeZone: z.string().default('Australia/Melbourne'),
  clinicType: ClinicTypeEnum,
  hpio: z
    .string()
    .transform((value) => value.trim().replace(HPIO_SEPARATORS, ''))
    .pipe(z.string().regex(HPIO_FORMAT, 'HPI-O must be 16 digits starting with 800362')),

  // Step 2: First admin user
  adminGivenName: z.string().min(1).max(100),
  adminFamilyName: z.string().min(1).max(100),
  adminEmail: z.string().email(),
  adminPhone: z.string().max(30).optional(),
  adminProfileTabVisible: z.boolean().default(true),
  // Onboarding contact person is always the clinic admin for the new
  // clinic. Superadmin accounts are platform-level and must never be
  // minted through tenant onboarding.
  adminRole: z.literal('admin').default('admin'),

  // Step 3: Branding
  sidebarTitle: z.string().max(200).optional(),
  sidebarSubtitle: z.string().max(200).optional(),

  // Step 4: Modules to enable
  enabledModules: z.array(z.string()).default([
    'patients', 'episodes', 'clinical_notes', 'medications',
    'appointments', 'tasks', 'reports',
  ]),
  enabledSpecialties: z.array(SpecialtyTypeEnum).default(['mental_health']),

  // Step 5: Reference data seeding
  seedDisciplines: z.boolean().default(true),
  seedClinicalRoles: z.boolean().default(true),
  seedMbsItems: z.boolean().default(true),
  seedReferralSources: z.boolean().default(true),
  seedAlertTypes: z.boolean().default(true),

  // Step 6: Subscription
  planType: z.enum(['monthly', 'annual', 'trial']).default('trial'),
  seats: z.number().int().positive().default(5),
  trialDays: z.number().int().positive().default(30).optional(),
  notes: z.string().optional(),
});
export type ProvisionClinicDTO = z.infer<typeof ProvisionClinicSchema>;

export interface ProvisionResult {
  clinicId: string;
  clinicName: string;
  adminEmail: string;
  adminTemporaryPassword: string;
  modulesEnabled: string[];
  referenceDataSeeded: {
    disciplines: number;
    clinicalRoles: number;
    mbsItems: number;
    referralSources: number;
    alertTypes: number;
    templateCategories: number;
    appointmentModes: number;
    templates: number;
  };
  subscriptionId: string | null;
}

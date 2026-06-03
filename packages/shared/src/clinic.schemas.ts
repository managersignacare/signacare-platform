// packages/shared-types/src/clinic.schemas.ts
import { z } from "zod";

/**
 * SSoT for the platform default clinic timezone. Referenced by the clinic
 * schema default AND by client-side clinic-local date math (due-date count
 * buckets / list date-range filter) so the two cannot drift apart.
 */
export const DEFAULT_CLINIC_TIME_ZONE = "Australia/Melbourne";

/**
 * BUG-339 — HPI-O format validator. Mirrors the server-side
 * validateHpioFormat in apps/api/src/integrations/hiService/hiServiceClient.ts:
 * 16 digits starting with 800362. Client-side form validation; server runs
 * validateHiNumber (format + Luhn) as the authoritative check.
 */
const HPIO_FORMAT = /^800362\d{10}$/;

export const ClinicBaseSchema = z.object({
  name: z.string().min(1, "Name is required"),
  legalName: z.string().optional(),
  abn: z.string().optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email().optional().or(z.literal('')),
  addressStreet: z.string().optional(),
  addressSuburb: z.string().optional(),
  addressState: z.string().optional(),
  addressPostcode: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
  timeZone: z.string().min(1, "Time zone is required").default(DEFAULT_CLINIC_TIME_ZONE),
  isActive: z.boolean().default(true),
});

export const ClinicCreateSchema = ClinicBaseSchema.extend({
  // BUG-334 A2-2 contract tightening: new clinic writes must carry HPI-O.
  hpio: z.string().regex(HPIO_FORMAT, 'HPI-O must be 16 digits starting with 800362'),
  npdsConformanceId: z.string().min(1).max(100).nullable().optional(),
  erxEtp1SiteId: z.string().min(1).max(100).nullable().optional(),
});
export type ClinicCreateDTO = z.infer<typeof ClinicCreateSchema>;

export const ClinicUpdateSchema = ClinicBaseSchema.partial().extend({
  hpio: z.string().regex(HPIO_FORMAT, 'HPI-O must be 16 digits starting with 800362').optional(),
  npdsConformanceId: z.string().min(1).max(100).nullable().optional(),
  erxEtp1SiteId: z.string().min(1).max(100).nullable().optional(),
});
export type ClinicUpdateDTO = z.infer<typeof ClinicUpdateSchema>;

export const ClinicResponseSchema = ClinicBaseSchema.extend({
  // Existing rows can still be null until BUG-334 Phase C enforcement.
  hpio: z.string().regex(HPIO_FORMAT, 'HPI-O must be 16 digits starting with 800362').nullable(),
  npdsConformanceId: z.string().min(1).max(100).nullable().optional(),
  erxEtp1SiteId: z.string().min(1).max(100).nullable().optional(),
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ClinicResponse = z.infer<typeof ClinicResponseSchema>;

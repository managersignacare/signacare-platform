// packages/shared-types/src/staff.schemas.ts
import { z } from "zod";
import { RoleEnum } from "./rbac.schemas";
import { SpecialtyTypeEnum } from "./specialty.schemas";

/**
 * A staff member's enrolment in a clinical specialty. A staff member
 * can be enrolled in multiple specialties; exactly one must be marked
 * `isPrimary = true` when the list is non-empty (the server normalises
 * this server-side if the caller forgets).
 */
export const StaffSpecialtyEnrollmentSchema = z.object({
  code: SpecialtyTypeEnum,
  isPrimary: z.boolean().optional(),
});
export type StaffSpecialtyEnrollment = z.infer<typeof StaffSpecialtyEnrollmentSchema>;

export const StaffBaseSchema = z.object({
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  email: z.string().email(),
  role: RoleEnum,
  isActive: z.boolean().default(true),
  discipline: z.string().optional(),
  phoneMobile: z.string().optional(),
});

export const StaffCredentialFields = z.object({
  ahpraNumber: z.string().optional(),
  ahpraExpiry: z.string().optional(),
  prescriberNumber: z.string().optional(),
  providerNumber: z.string().optional(),
  hpii: z.string().optional(),
  qualifications: z.string().optional(),
  specialisation: z.string().optional(),
  phoneWork: z.string().optional(),
});

export const StaffCreateSchema = StaffBaseSchema.merge(StaffCredentialFields).extend({
  clinicId: z.string().uuid(),
  /** When omitted, a random temporary password is generated and returned to the admin. */
  password: z.string().min(8).max(128)
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/, 'Password must contain at least one special character')
    .optional(),
  requireMfa: z.boolean().default(false),
  // Additional onboarding fields that the service handles (not DB columns directly)
  isPrescriber: z.boolean().optional(),
  phone: z.string().optional(),
  providerNumbers: z.array(z.object({
    type: z.string(),
    number: z.string(),
    location: z.string().optional(),
  })).optional(),
  phiProvider: z.string().optional(),
  phiNumber: z.string().optional(),
  /**
   * Controls visibility of Settings -> My Profile for this staff member.
   * Managed by clinic admins during onboarding / staff edits.
   */
  settingsProfileTabVisible: z.boolean().optional(),
  /** Clinical specialty enrolments. Server replaces the full set on save. */
  specialties: z.array(StaffSpecialtyEnrollmentSchema).optional(),
});
export type StaffCreateDTO = z.infer<typeof StaffCreateSchema>;

export const StaffUpdateSchema = StaffBaseSchema.partial().merge(StaffCredentialFields).extend({
  requireMfa: z.boolean().optional(),
  isPrescriber: z.boolean().optional(),
  providerNumbers: z.array(z.object({
    type: z.string(),
    number: z.string(),
    location: z.string().optional(),
  })).optional(),
  phiProvider: z.string().optional(),
  phiNumber: z.string().optional(),
  settingsProfileTabVisible: z.boolean().optional(),
  /**
   * Clinical specialty enrolments. When present (even as an empty array),
   * the server replaces the entire set for this staff member. When omitted,
   * the existing set is left untouched.
   */
  specialties: z.array(StaffSpecialtyEnrollmentSchema).optional(),
});
export type StaffUpdateDTO = z.infer<typeof StaffUpdateSchema>;

export const StaffResponseSchema = StaffBaseSchema.merge(StaffCredentialFields).extend({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  settingsProfileTabVisible: z.boolean().optional(),
  requireMfa: z.boolean(),
  hasMfaConfigured: z.boolean(),
  mfaEnabled: z.boolean().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  specialties: z.array(StaffSpecialtyEnrollmentSchema).optional(),
});
export type StaffResponse = z.infer<typeof StaffResponseSchema>;

// Self-service profile update (PUT /staff/me) — credential fields only, no role/isActive
export const StaffSelfUpdateSchema = StaffCredentialFields.extend({
  givenName: z.string().min(1).optional(),
  familyName: z.string().min(1).optional(),
  email: z.string().email().optional(),
  discipline: z.string().optional(),
  phoneMobile: z.string().optional(),
  specialties: z.array(StaffSpecialtyEnrollmentSchema).optional(),
});
export type StaffSelfUpdateDTO = z.infer<typeof StaffSelfUpdateSchema>;

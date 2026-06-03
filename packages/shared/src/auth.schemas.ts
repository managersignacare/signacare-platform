// packages/shared-types/src/auth.schemas.ts
import { z } from "zod";
import { RoleEnum, PermissionEnum } from "./rbac.schemas";

export const LoginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});
export type LoginDTO = z.infer<typeof LoginSchema>;

export const MfaVerifySchema = z.object({
  tempToken: z.string().min(1, "Temp token is required"),
  token: z.string().length(6, "TOTP code must be 6 digits").regex(/^\d{6}$/),
});
export type MFAVerifyDTO = z.infer<typeof MfaVerifySchema>;

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  clinicId: z.string().uuid(),
  givenName: z.string(),
  familyName: z.string(),
  email: z.string().email().nullable().optional(),
  role: RoleEnum,
  permissions: z.array(PermissionEnum).optional(),
  // Patient-app (Viva) auth carries the patients.id in the JWT so
  // route handlers can gate patient-scoped data. Absent on staff
  // JWTs. Phase 11B FCM registration + sync-preferences routes
  // read this field to key patient_fcm_tokens.patient_id.
  patientId: z.string().uuid().nullable().optional(),
  isPatientApp: z.boolean().optional(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

export const TokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  user: AuthUserSchema,
});
export type TokenResponse = z.infer<typeof TokenResponseSchema>;

export const MfaRequiredResponseSchema = z.object({
  mfaRequired: z.literal(true),
  tempToken: z.string(),
});
export type MfaRequiredResponse = z.infer<typeof MfaRequiredResponseSchema>;

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});
export type ChangePasswordDTO = z.infer<typeof ChangePasswordSchema>;

export const MfaConfirmSchema = z.object({
  token: z.string().length(6).regex(/^\d{6}$/),
});
export type MfaConfirmDTO = z.infer<typeof MfaConfirmSchema>;

export const VerifyMfaChallengeSchema = z.object({
  code: z.string().min(1, 'Code is required'),
});
export type VerifyMfaChallengeDTO = z.infer<typeof VerifyMfaChallengeSchema>;

export const VerifyPasswordChallengeSchema = z.object({
  password: z.string().min(1, 'Password is required'),
});
export type VerifyPasswordChallengeDTO = z.infer<typeof VerifyPasswordChallengeSchema>;

export const SignatureSchema = z.object({
  signature: z.string().min(1, 'Signature (base64 string) is required'),
});
export type SignatureDTO = z.infer<typeof SignatureSchema>;
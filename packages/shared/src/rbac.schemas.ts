// packages/shared-types/src/rbac.schemas.ts
import { z } from "zod";

export const RoleEnum = z.enum([
  "superadmin",
  "admin",
  "clinician",
  "manager",
  "receptionist",
  "readonly",
  "referral_coordinator",
]);

export type Role = z.infer<typeof RoleEnum>;

export const PermissionEnum = z.enum([
  // Clinic
  "clinic:read",
  "clinic:create",
  "clinic:update",
  "clinic:delete",
  // Staff
  "staff:read",
  "staff:create",
  "staff:update",
  "staff:delete",
  // Patients
  "patient:read",
  "patient:create",
  "patient:update",
  "patient:delete",
  // Episodes
  "episode:read",
  "episode:create",
  "episode:update",
  // Appointments
  "appointment:read",
  "appointment:create",
  "appointment:update",
  "appointment:delete",
  // Clinical notes
  "note:read",
  "note:create",
  "note:update",
  "note:delete",
  // Medications
  "medication:read",
  "medication:create",
  "medication:update",
  // Prescriptions
  "prescription:read",
  "prescription:create",
  // Pathology
  "pathology:read",
  "pathology:create",
  // Billing
  "billing:read",
  "billing:create",
  "billing:update",
  // Tasks
  "task:read",
  "task:create",
  "task:update",
  "task:delete",
  // Messaging
  "message:read",
  "message:create",
  // Reports
  "report:read",
  // Settings
  "settings:read",
  "settings:update",
  // MH Act
  "mhact:read",
  "mhact:create",
  "mhact:update",
  // Referrals
  "referral:read",
  "referral:create",
  "referral:update",
  "referral:triage",
  "referral:assign",
  // Specialty enrollment (ABAC is data-driven via staff_specialties)
  "specialty:enroll",
  // Notifications (Phase 10A — durable notification centre)
  "notification:read",
  "notification:update",
  "notification:delete",
]);

export type Permission = z.infer<typeof PermissionEnum>;

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  superadmin: PermissionEnum.options as Permission[],
  admin: [
    "clinic:read", "clinic:update",
    "staff:read", "staff:create", "staff:update", "staff:delete",
    "patient:read", "patient:create", "patient:update",
    "episode:read", "episode:create", "episode:update",
    "appointment:read", "appointment:create", "appointment:update", "appointment:delete",
    "note:read", "note:create", "note:update",
    "medication:read", "medication:create", "medication:update",
    "prescription:read", "prescription:create",
    "pathology:read", "pathology:create",
    "billing:read", "billing:create", "billing:update",
    "task:read", "task:create", "task:update", "task:delete",
    "message:read", "message:create",
    "report:read",
    "settings:read", "settings:update",
    "mhact:read", "mhact:create", "mhact:update",
    "referral:read", "referral:create", "referral:update",
    "notification:read", "notification:update", "notification:delete",
  ],
  manager: [
    "clinic:read",
    "staff:read",
    "patient:read",
    "episode:read",
    "appointment:read", "appointment:create", "appointment:update",
    "billing:read", "billing:create", "billing:update",
    "task:read", "task:create", "task:update",
    "message:read", "message:create",
    "report:read",
    "settings:read",
    "referral:read", "referral:create", "referral:update",
    "notification:read", "notification:update", "notification:delete",
  ],
  clinician: [
    "patient:read", "patient:create", "patient:update",
    "episode:read", "episode:create", "episode:update",
    "appointment:read", "appointment:create", "appointment:update",
    "note:read", "note:create", "note:update",
    "medication:read", "medication:create", "medication:update",
    "prescription:read", "prescription:create",
    "pathology:read", "pathology:create",
    "task:read", "task:create", "task:update",
    "message:read", "message:create",
    "mhact:read", "mhact:create", "mhact:update",
    "referral:read", "referral:create", "referral:update", "referral:triage",
    "notification:read", "notification:update", "notification:delete",
  ],
  receptionist: [
    "patient:read", "patient:create",
    "appointment:read", "appointment:create", "appointment:update",
    "task:read", "task:create",
    "message:read", "message:create",
    "referral:read",
    "notification:read", "notification:update", "notification:delete",
  ],
  readonly: [
    "patient:read",
    "episode:read",
    "appointment:read",
    "note:read",
    "report:read",
    "notification:read",
  ],
  referral_coordinator: [
    "patient:read",
    "episode:read",
    "referral:read", "referral:create", "referral:update", "referral:triage", "referral:assign",
    "task:read", "task:create", "task:update",
    "message:read", "message:create",
    "notification:read", "notification:update", "notification:delete",
  ],
};
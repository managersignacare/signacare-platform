// apps/api/src/shared/authConstants.ts
//
// SSoT for role-based access primitives shared between live auth
// guards (shared/authGuards.ts) and retrospective audit tooling
// (scripts/audit-llm-interactions-contamination.ts). Extracted per
// BUG-280 L5 architectural review — pre-extract, the two files had
// independent copies of the list; any addition to the set in one
// file would silently miscategorise access in the other.

/**
 * Roles that bypass requirePermission + requireSpecialty +
 * requirePrescribingDiscipline + requireValidHpii.
 *
 * Phase 0.5.B scope narrowed: these roles NO LONGER bypass
 * requirePatientRelationship (clinical-data access). The clinical
 * rail is now entirely relationship-based — nominated/delegated
 * admin for the patient's clinic, episode assignment, team
 * membership (plain or role-based, with hierarchy cascade), or
 * appointment attendee. Role alone is no longer sufficient.
 *
 * This set is still used by:
 *   - requirePermission — module-level permissions (module concern)
 *   - requireSpecialty — discipline barrier (discipline concern)
 *   - requirePrescribingDiscipline — AHPRA discipline (same)
 *   - requireValidHpii — HPI-I validation (same)
 *
 * Retrospective audit (audit-llm-interactions-contamination.ts)
 * still uses BYPASS_ROLES for historical contamination classification
 * because the policy was role-based at the time those rows were
 * written. New rows use writeLlmAccessBypassAudit which records the
 * ACTUAL relationship reason (nominated/delegated/team/episode).
 *
 * IMPORTANT: any change to this list must be mirrored across all
 * four callers above. Adding a role here retroactively alters every
 * permission/specialty/HPI-I gate; removing a role retroactively
 * strictens them. Document reason in PR body + catalogue entry.
 */
export const BYPASS_ROLES: ReadonlySet<string> = new Set(['superadmin', 'admin']);

/**
 * Phase 0.5.B — purely operational staff roles. These have NO
 * clinical-data access regardless of team attachment. Blocks the
 * receptionist / readonly persona from reading clinical notes,
 * patient meds, etc. even if they're on the patient's team roster
 * (which happens for front-desk staff assigned to a clinic's
 * patient-facing surface).
 *
 * Enforced by requireClinicalAccessRole(auth) in authGuards.ts.
 *
 * L5-absorb-1: re-exported from @signacare/shared/permissions so
 * frontend (Sidebar.tsx) and backend authGuards both consume the
 * SAME set — any future addition lands in exactly one place
 * (packages/shared/src/permissions.ts) and automatically flows to
 * both. Same pattern as BUG-280 for BYPASS_ROLES.
 */
import { OPERATIONAL_ONLY } from '@signacare/shared';
export const OPERATIONAL_ONLY_ROLES: ReadonlySet<string> = OPERATIONAL_ONLY;

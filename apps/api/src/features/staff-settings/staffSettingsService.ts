import * as repo from './staffSettingsRepository'
import { HttpError } from '../../shared/errors'
import type { AuthContext } from '@signacare/shared'

function mapDiscipline(r: repo.DisciplineRow) {
  return { id: r.id, clinicId: r.clinic_id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order }
}
function mapRole(r: repo.ClinicalRoleRow) {
  return { id: r.id, clinicId: r.clinic_id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order }
}
function mapTeam(r: repo.StaffTeamRow & { org_unit_name?: string; staff_name?: string }) {
  return { id: r.id, staffId: r.staff_id, orgUnitId: r.org_unit_id, orgUnitName: r.org_unit_name ?? '', startDate: r.start_date, endDate: r.end_date, isActive: r.is_active, staffName: r.staff_name ?? '' }
}
function mapRoleAssign(r: repo.StaffRoleRow & { org_unit_name?: string; clinical_role_name?: string; staff_name?: string }) {
  return { id: r.id, staffId: r.staff_id, orgUnitId: r.org_unit_id, orgUnitName: r.org_unit_name ?? '', clinicalRoleId: r.clinical_role_id, clinicalRoleName: r.clinical_role_name ?? '', roleType: r.role_type, startDate: r.start_date, endDate: r.end_date, isActive: r.is_active, staffName: r.staff_name ?? '' }
}

function assertClinicScope(auth: AuthContext, clinicId: string): void {
  if (auth.role !== 'superadmin' && auth.clinicId !== clinicId) {
    throw new HttpError(403, 'FORBIDDEN', 'Cross-clinic staff-assignment access is superadmin-only')
  }
}

// BUG-STAFF-SETTINGS-CLINIC-ID-FILTER (S1) 2026-05-06: thread clinicId
// through 12 update/delete service methods + 2 insert methods (Group 2
// — staff_team_assignments + staff_role_assignments — now require
// clinic_id as a real column per migration 20260701000054). Repository
// is grandfathered for §13 AuthContext per check-service-auth-context
// allowlist; using `clinicId: string` as first-param matches existing
// repo signature style (find/insert already use clinicId-first).
export const staffSettingsService = {
  // Disciplines
  async getDisciplines(clinicId: string) { return (await repo.findDisciplines(clinicId)).map(mapDiscipline) },
  async createDiscipline(clinicId: string, name: string, sortOrder?: number) { return mapDiscipline(await repo.insertDiscipline(clinicId, name, sortOrder)) },
  async updateDiscipline(clinicId: string, id: string, data: Partial<{ name: string; is_active: boolean; sort_order: number }>) { const r = await repo.updateDiscipline(clinicId, id, data); return r ? mapDiscipline(r) : null },
  async deleteDiscipline(clinicId: string, id: string) { await repo.deleteDiscipline(clinicId, id) },

  // Clinical Roles
  async getClinicalRoles(clinicId: string) { return (await repo.findClinicalRoles(clinicId)).map(mapRole) },
  async createClinicalRole(clinicId: string, name: string, sortOrder?: number) { return mapRole(await repo.insertClinicalRole(clinicId, name, sortOrder)) },
  async updateClinicalRole(clinicId: string, id: string, data: Partial<{ name: string; is_active: boolean; sort_order: number }>) { const r = await repo.updateClinicalRole(clinicId, id, data); return r ? mapRole(r) : null },
  async deleteClinicalRole(clinicId: string, id: string) { await repo.deleteClinicalRole(clinicId, id) },

  // Team Assignments
  async getTeamAssignmentsByStaff(auth: AuthContext, staffId: string, clinicId: string) {
    assertClinicScope(auth, clinicId)
    return (await repo.findTeamAssignmentsByStaff(staffId, clinicId)).map(mapTeam)
  },
  async getTeamAssignmentsByClinic(clinicId: string) { return (await repo.findTeamAssignmentsByClinic(clinicId)).map(mapTeam) },
  async createTeamAssignment(auth: AuthContext, clinicId: string, data: { staffId: string; orgUnitId: string; startDate: string; endDate?: string | null }) {
    assertClinicScope(auth, clinicId)
    if (!(await repo.staffExistsInClinic(data.staffId, clinicId))) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Staff member not found in selected clinic')
    }
    if (!(await repo.orgUnitExistsInClinic(data.orgUnitId, clinicId))) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Team or unit not found in selected clinic')
    }
    return mapTeam(await repo.insertTeamAssignment(clinicId, data))
  },
  async updateTeamAssignment(clinicId: string, id: string, data: Partial<{ end_date: string | null; is_active: boolean }>) { const r = await repo.updateTeamAssignment(clinicId, id, data); return r ? mapTeam(r) : null },
  async deleteTeamAssignment(clinicId: string, id: string) { await repo.deleteTeamAssignment(clinicId, id) },

  // Role Assignments
  async getRoleAssignmentsByStaff(auth: AuthContext, staffId: string, clinicId: string) {
    assertClinicScope(auth, clinicId)
    return (await repo.findRoleAssignmentsByStaff(staffId, clinicId)).map(mapRoleAssign)
  },
  async getRoleAssignmentsByClinic(clinicId: string) { return (await repo.findRoleAssignmentsByClinic(clinicId)).map(mapRoleAssign) },
  async createRoleAssignment(auth: AuthContext, clinicId: string, data: { staffId: string; orgUnitId: string; clinicalRoleId: string; roleType: string; startDate: string; endDate?: string | null }) {
    assertClinicScope(auth, clinicId)
    if (!(await repo.staffExistsInClinic(data.staffId, clinicId))) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Staff member not found in selected clinic')
    }
    if (!(await repo.orgUnitExistsInClinic(data.orgUnitId, clinicId))) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Team or unit not found in selected clinic')
    }
    if (!(await repo.clinicalRoleExistsInClinic(data.clinicalRoleId, clinicId))) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Clinical role not found in selected clinic')
    }
    return mapRoleAssign(await repo.insertRoleAssignment(clinicId, data))
  },
  async updateRoleAssignment(clinicId: string, id: string, data: Partial<{ end_date: string | null; is_active: boolean; role_type: string }>) { const r = await repo.updateRoleAssignment(clinicId, id, data); return r ? mapRoleAssign(r) : null },
  async deleteRoleAssignment(clinicId: string, id: string) { await repo.deleteRoleAssignment(clinicId, id) },

  // Referral Sources
  async getReferralSources(clinicId: string) { return (await repo.findReferralSources(clinicId)).map(r => ({ id: r.id, clinicId: r.clinic_id, category: r.category, name: r.name, isActive: r.is_active, sortOrder: r.sort_order })) },
  async createReferralSource(clinicId: string, category: string, name: string, sortOrder?: number) { const r = await repo.insertReferralSource(clinicId, category, name, sortOrder); return { id: r.id, clinicId: r.clinic_id, category: r.category, name: r.name, isActive: r.is_active, sortOrder: r.sort_order } },
  async updateReferralSource(clinicId: string, id: string, data: Partial<{ name: string; category: string; is_active: boolean; sort_order: number }>) { const r = await repo.updateReferralSource(clinicId, id, data); return r ? { id: r.id, clinicId: r.clinic_id, category: r.category, name: r.name, isActive: r.is_active, sortOrder: r.sort_order } : null },
  async deleteReferralSource(clinicId: string, id: string) { await repo.deleteReferralSource(clinicId, id) },

  // Investigation Types
  async getInvestigationTypes(clinicId: string) { return (await repo.findInvestigationTypes(clinicId)).map(r => ({ id: r.id, clinicId: r.clinic_id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order })) },
  async createInvestigationType(clinicId: string, name: string, sortOrder?: number) { const r = await repo.insertInvestigationType(clinicId, name, sortOrder); return { id: r.id, clinicId: r.clinic_id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order } },
  async updateInvestigationType(clinicId: string, id: string, data: Partial<{ name: string; is_active: boolean; sort_order: number }>) { const r = await repo.updateInvestigationType(clinicId, id, data); return r ? { id: r.id, clinicId: r.clinic_id, name: r.name, isActive: r.is_active, sortOrder: r.sort_order } : null },
  async deleteInvestigationType(clinicId: string, id: string) { await repo.deleteInvestigationType(clinicId, id) },
}

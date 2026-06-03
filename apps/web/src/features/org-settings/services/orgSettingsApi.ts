import { apiClient } from '../../../shared/services/apiClient'

export interface LevelLabel {
  id: string
  clinicId: string
  level: number
  label: string
}

export interface OrgUnit {
  id: string
  clinicId: string
  parentId: string | null
  name: string
  level: number
  sortOrder: number
  isActive: boolean
  children?: OrgUnit[]
  programs?: { id: string; name: string }[]
}

type OrgUnitWire = Omit<OrgUnit, 'level' | 'children'> & {
  level: number | string
  children?: OrgUnitWire[]
}

export interface Program {
  id: string
  clinicId: string
  name: string
  description: string | null
  isActive: boolean
}

interface OrgTreeResponse {
  tree?: OrgUnitWire[]
}

interface OrgUnitsResponse {
  units?: OrgUnitWire[]
}

function toNumericLevel(level: number | string): number {
  if (typeof level === 'number' && Number.isFinite(level)) {
    return Math.max(1, level)
  }
  const parsed = Number.parseInt(String(level), 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function normalizeOrgUnit(unit: OrgUnitWire): OrgUnit {
  return {
    ...unit,
    level: toNumericLevel(unit.level),
    children: unit.children?.map(normalizeOrgUnit),
  }
}

export const orgSettingsApi = {
  // Level labels
  getLevelLabels(): Promise<LevelLabel[]> {
    return apiClient
      .get<{ labels: LevelLabel[] }>('org-settings/level-labels')
      .then((r) => r.labels)
  },

  bulkSetLevelLabels(labels: { level: number; label: string }[]): Promise<LevelLabel[]> {
    return apiClient
      .put<{ labels: LevelLabel[] }>('org-settings/level-labels', { labels })
      .then((r) => r.labels)
  },

  // Org units
  getOrgTree(clinicId?: string): Promise<OrgUnit[]> {
    return apiClient
      .get<OrgTreeResponse | OrgUnitWire[]>(
        'org-settings/units/tree',
        clinicId ? { clinicId } : undefined,
      )
      .then((r) => {
        if (Array.isArray(r)) return r.map(normalizeOrgUnit)
        if (Array.isArray(r.tree)) return r.tree.map(normalizeOrgUnit)
        return []
      })
      .catch((err) => { console.warn('orgSettingsApi: query failed', err); return []; })
  },

  getFlatUnits(): Promise<OrgUnit[]> {
    return apiClient
      .get<OrgUnitsResponse | OrgUnitWire[]>('org-settings/units')
      .then((r) => {
        if (Array.isArray(r)) return r.map(normalizeOrgUnit)
        if (Array.isArray(r.units)) return r.units.map(normalizeOrgUnit)
        return []
      })
  },

  createUnit(data: {
    parentId?: string | null
    name: string
    level: number
    sortOrder?: number
  }): Promise<OrgUnit> {
    return apiClient
      .post<{ unit: OrgUnitWire }>('org-settings/units', data)
      .then((r) => normalizeOrgUnit(r.unit))
  },

  updateUnit(id: string, data: { name?: string; sortOrder?: number; isActive?: boolean; teamLeaderId?: string | null; managerId?: string | null; managementStaff1Id?: string | null; managementStaff2Id?: string | null; managementStaff3Id?: string | null }): Promise<OrgUnit> {
    return apiClient
      .patch<{ unit: OrgUnitWire }>(`org-settings/units/${id}`, data)
      .then((r) => normalizeOrgUnit(r.unit))
  },

  deleteUnit(id: string): Promise<void> {
    return apiClient.delete(`org-settings/units/${id}`)
  },

  // Programs
  getPrograms(): Promise<Program[]> {
    return apiClient
      .get<{ programs: Program[] }>('org-settings/programs')
      .then((r) => r.programs)
  },

  createProgram(data: { name: string; description?: string }): Promise<Program> {
    return apiClient
      .post<{ program: Program }>('org-settings/programs', data)
      .then((r) => r.program)
  },

  updateProgram(id: string, data: { name?: string; description?: string; isActive?: boolean }): Promise<Program> {
    return apiClient
      .patch<{ program: Program }>(`org-settings/programs/${id}`, data)
      .then((r) => r.program)
  },

  deleteProgram(id: string): Promise<void> {
    return apiClient.delete(`org-settings/programs/${id}`)
  },

  // Program assignments
  assignProgram(orgUnitId: string, programId: string): Promise<void> {
    return apiClient.post('org-settings/assignments', { orgUnitId, programId }).then(() => undefined)
  },

  unassignProgram(orgUnitId: string, programId: string): Promise<void> {
    return apiClient.instance.delete('org-settings/assignments', { data: { orgUnitId, programId } }).then(() => undefined)
  },
}

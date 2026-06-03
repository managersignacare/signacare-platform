import {
  findLabelsByClinic,
  upsertLevelLabel,
  findUnitsByClinic,
  findUnitById,
  insertUnit,
  updateUnit,
  deleteUnit,
  findProgramsByClinic,
  insertProgram,
  updateProgram,
  deleteProgram,
  findAssignmentsByClinic,
  assignProgram,
  unassignProgram,
  type OrgUnitRow,
  type ProgramRow,
  type OrgLevelLabelRow,
} from './orgSettingsRepository'

const MAX_ORG_LEVEL = 10

function parseNumericLevel(level: string | number): number | null {
  if (typeof level === 'number' && Number.isFinite(level)) return level
  const parsed = Number.parseInt(String(level), 10)
  return Number.isFinite(parsed) ? parsed : null
}

function mapLabel(row: OrgLevelLabelRow) {
  return { id: row.id, clinicId: row.clinic_id, level: row.level, label: row.label }
}

function mapUnit(row: OrgUnitRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    parentId: row.parent_id,
    name: row.name,
    level: row.level,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }
}

function mapProgram(row: ProgramRow) {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    description: row.description,
    isActive: row.is_active,
  }
}

export const orgSettingsService = {
  // --- Level Labels ---
  async getLevelLabels(clinicId: string) {
    const rows = await findLabelsByClinic(clinicId)
    return rows.map(mapLabel)
  },

  async bulkSetLevelLabels(clinicId: string, labels: { level: number; label: string }[]) {
    await Promise.all(
      labels.map((l) => upsertLevelLabel(clinicId, l.level, l.label)),
    )
    return this.getLevelLabels(clinicId)
  },

  // --- Org Units ---
  async getOrgTree(clinicId: string) {
    const rows = await findUnitsByClinic(clinicId)
    const assignments = await findAssignmentsByClinic(clinicId)
    const programs = await findProgramsByClinic(clinicId)

    const programMap = new Map(programs.map((p) => [p.id, mapProgram(p)]))
    const flat = rows.map(mapUnit)

    // Attach programs to each unit. Phase 0.7.5 c24 C8 — the assignment
    // row's FK has been denormalised to `name`; findAssignmentsByClinic
    // rejoins with programs so each row carries program_id for the API
    // response.
    const unitPrograms = new Map<string, { id: string; name: string }[]>()
    for (const a of assignments) {
      const prog = a.program_id ? programMap.get(a.program_id) : null
      if (prog) {
        const list = unitPrograms.get(a.org_unit_id) ?? []
        list.push({ id: prog.id, name: prog.name })
        unitPrograms.set(a.org_unit_id, list)
      }
    }

    // Build tree
    const nodeMap = new Map<string, typeof flat[0] & { children: typeof flat; programs: { id: string; name: string }[] }>()
    const roots: (typeof flat[0] & { children: typeof flat; programs: { id: string; name: string }[] })[] = []

    for (const unit of flat) {
      const node = { ...unit, children: [] as typeof flat, programs: unitPrograms.get(unit.id) ?? [] }
      nodeMap.set(unit.id, node)
    }

    for (const node of nodeMap.values()) {
      if (node.parentId && nodeMap.has(node.parentId)) {
        nodeMap.get(node.parentId)!.children.push(node)
      } else {
        roots.push(node)
      }
    }

    return roots
  },

  async getFlatOrgUnits(clinicId: string) {
    const rows = await findUnitsByClinic(clinicId)
    return rows.map(mapUnit)
  },

  async createOrgUnit(clinicId: string, data: {
    parentId?: string | null
    name: string
    level?: number
    sortOrder?: number
    isActive?: boolean
  }) {
    let resolvedLevel = data.level ?? 1
    if (data.parentId) {
      const parent = await findUnitById(data.parentId)
      if (parent && parent.clinic_id === clinicId) {
        const parentLevel = parseNumericLevel(parent.level)
        if (parentLevel !== null) {
          resolvedLevel = parentLevel + 1
        }
      }
    }
    const boundedLevel = Math.min(Math.max(1, resolvedLevel), MAX_ORG_LEVEL)
    const row = await insertUnit({
      clinicId,
      parentId: data.parentId ?? null,
      name: data.name,
      level: String(boundedLevel),
      sortOrder: data.sortOrder ?? 0,
      isActive: data.isActive ?? true,
    })
    return mapUnit(row)
  },

  async updateOrgUnit(id: string, data: { name?: string; sortOrder?: number; isActive?: boolean; teamLeaderId?: string | null; managerId?: string | null; managementStaff1Id?: string | null; managementStaff2Id?: string | null; managementStaff3Id?: string | null }) {
    // org_units table only has: id, clinic_id, name, level, parent_id,
    // sort_order, is_active, created_at, updated_at. Leadership roles
    // (teamLeader/manager/managementStaff1-3) are NOT persisted via this
    // path — they belong in staff_team_assignments. The frontend passes
    // them for a future migration; silently dropping them here is
    // documented behaviour, not a band-aid.
    const patch: Partial<{ name: string; sort_order: number; is_active: boolean }> = {}
    if (data.name !== undefined) patch.name = data.name
    if (data.sortOrder !== undefined) patch.sort_order = data.sortOrder
    if (data.isActive !== undefined) patch.is_active = data.isActive
    const row = await updateUnit(id, patch)
    return row ? mapUnit(row) : null
  },

  async deleteOrgUnit(id: string) {
    await deleteUnit(id)
  },

  // --- Programs ---
  async getPrograms(clinicId: string) {
    const rows = await findProgramsByClinic(clinicId)
    return rows.map(mapProgram)
  },

  async createProgram(clinicId: string, data: { name: string; description?: string }) {
    const row = await insertProgram({ clinicId, ...data })
    return mapProgram(row)
  },

  async updateProgram(id: string, data: { name?: string; description?: string; isActive?: boolean }) {
    const patch: Partial<{ name: string; description: string; is_active: boolean }> = {}
    if (data.name !== undefined) patch.name = data.name
    if (data.description !== undefined) patch.description = data.description
    if (data.isActive !== undefined) patch.is_active = data.isActive
    const row = await updateProgram(id, patch)
    return row ? mapProgram(row) : null
  },

  async deleteProgram(id: string) {
    await deleteProgram(id)
  },

  // --- Assignments ---
  // Phase 0.7.5 c24 C8 — clinicId now required (was inferred from the
  // orgUnit's join before; explicit scoping prevents cross-clinic
  // writes).
  async assignProgram(clinicId: string, orgUnitId: string, programId: string) {
    await assignProgram(clinicId, orgUnitId, programId)
  },

  async unassignProgram(clinicId: string, orgUnitId: string, programId: string) {
    await unassignProgram(clinicId, orgUnitId, programId)
  },
}

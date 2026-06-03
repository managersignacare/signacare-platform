import AddIcon from '@mui/icons-material/Add'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import {
    Alert, Box, Button, Chip, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl,
    Grid, InputLabel, MenuItem, Paper, Select, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow, TextField, Typography
} from '@mui/material'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { ListExportBar } from '../../../shared/components/ui/ListExportBar'
import { apiClient } from '../../../shared/services/apiClient'
import { useAuthStore } from '../../../store/authStore'
import {
  staffKeys,
  staffSettingsKeys,
} from '../queryKeys'
import { useOrgTree } from '../../org-settings/hooks/useOrgSettings'
import type { OrgUnit } from '../../org-settings/services/orgSettingsApi'
import { EditStaffCredentialsDialog } from '../components/EditStaffCredentialsDialog'
import { StaffOnboardDialog } from '../components/StaffOnboardDialog'
import type { ClinicalRole } from '../services/staffSettingsApi'
import {
    useClinicalRoles, useCreateRoleAssignment, useCreateTeamAssignment, useRoleAssignments, useTeamAssignments, useUpdateRoleAssignment, useUpdateTeamAssignment
} from '../hooks/useStaffSettings'
import {
  ASSIGNABLE_ROLE_TYPES,
  type AssignableRoleType,
  type RoleAssignmentCompat,
  type StaffLookupRow,
  type TeamAssignmentCompat,
  normalizeAssignableRoleType,
  readStaffApiError,
} from './staffAssignmentsPageSupport'
import {
  filterStaffDirectory,
  getRoleVisual,
  getUniqueStaffRoles,
  getUniqueStaffTeams,
} from './staffDirectoryViewModel'

function flattenUnits(nodes: OrgUnit[]): { id: string; name: string; level: number }[] {
  const result: { id: string; name: string; level: number }[] = []
  function walk(list: OrgUnit[], depth: number) {
    for (const n of list) {
      result.push({ id: n.id, name: '\u00A0'.repeat(depth * 2) + n.name, level: n.level })
      if (n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return result
}

function useStaffList(clinicId?: string) {
  return useQuery({
    queryKey: [...staffKeys.lookup(), clinicId ?? 'session'],
    queryFn: () => {
      const clinicQuery = clinicId ? `?clinicId=${encodeURIComponent(clinicId)}` : ''
      return apiClient.get<StaffLookupRow[]>(`staff/lookup${clinicQuery}`)
    },
  })
}

function humanizeLabel(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function readTeamAssignmentStaffId(assignment: TeamAssignmentCompat): string | null {
  return assignment.staffId ?? assignment.staff_id ?? null
}

function readTeamAssignmentName(assignment: TeamAssignmentCompat): string {
  return (assignment.orgUnitName ?? assignment.org_unit_name ?? assignment.orgunitname ?? '').trim()
}

function readTeamAssignmentActive(assignment: TeamAssignmentCompat): boolean {
  return assignment.isActive ?? assignment.is_active ?? true
}

function readRoleAssignmentStaffId(assignment: RoleAssignmentCompat): string | null {
  return assignment.staffId ?? assignment.staff_id ?? null
}

function readRoleAssignmentActive(assignment: RoleAssignmentCompat): boolean {
  return assignment.isActive ?? assignment.is_active ?? true
}

function readRoleAssignmentLabel(assignment: RoleAssignmentCompat): string {
  const roleName = (
    assignment.clinicalRoleName
    ?? assignment.clinical_role_name
    ?? assignment.clinicalrolename
    ?? ''
  ).trim()
  if (!roleName) return ''
  const teamName = (
    assignment.orgUnitName
    ?? assignment.org_unit_name
    ?? assignment.orgunitname
    ?? ''
  ).trim()
  return teamName ? `${roleName} - ${teamName}` : roleName
}

export const StaffAssignmentsPage: React.FC = () => {
  const user = useAuthStore((s) => s.user)
  const isSuperadmin = user?.role === 'superadmin'
  const canManageByRole = user?.role === 'admin' || user?.role === 'superadmin'
  const sessionClinicId = user?.clinicId ?? ''
  const [selectedClinicId, setSelectedClinicId] = React.useState<string>(sessionClinicId)

  const { data: clinics } = useQuery({
    queryKey: ['clinics', 'lookup', 'staff-assignments'],
    queryFn: () => apiClient.get<Array<{ id: string; name: string }>>('clinics/lookup'),
    enabled: isSuperadmin,
  })

  React.useEffect(() => {
    if (!isSuperadmin) {
      setSelectedClinicId(sessionClinicId)
      return
    }
    if (!selectedClinicId && clinics && clinics.length > 0) {
      setSelectedClinicId(clinics[0].id)
    }
  }, [isSuperadmin, sessionClinicId, selectedClinicId, clinics])

  const effectiveClinicId = isSuperadmin ? selectedClinicId : sessionClinicId
  const canManageSelectedClinic = canManageByRole && (!isSuperadmin || Boolean(selectedClinicId))
  const manageDisabledReason = canManageByRole
    ? 'Editing and assignment management are only enabled when the selected clinic matches your signed-in clinic context.'
    : 'Editing and assignment management require admin or superadmin access.'

  const [onboardOpen, setOnboardOpen] = React.useState(false)
  const [manageStaffId, setManageStaffId] = React.useState<string | null>(null)
  const [editStaffId, setEditStaffId] = React.useState<string | null>(null)

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3 }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
            Staff Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Onboard staff, assign to teams/units and clinical roles
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<PersonAddIcon />} onClick={() => setOnboardOpen(true)}
          disabled={!canManageSelectedClinic}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' }, textTransform: 'none', fontWeight: 600 }}>
          Add Staff
        </Button>
      </Box>

      {isSuperadmin && (
        <Box sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 320 }}>
            <InputLabel>Clinic Scope</InputLabel>
            <Select
              label="Clinic Scope"
              value={selectedClinicId}
              onChange={(e) => setSelectedClinicId(e.target.value)}
            >
              {(clinics ?? []).map((clinic) => (
                <MenuItem key={clinic.id} value={clinic.id}>{clinic.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            Superadmin actions in this page apply to the selected clinic.
          </Typography>
        </Box>
      )}

      <Divider sx={{ mb: 3 }} />

      <StaffDirectoryPanel
        clinicId={effectiveClinicId}
        canManage={canManageSelectedClinic}
        manageDisabledReason={manageDisabledReason}
        onManage={setManageStaffId}
        onEdit={setEditStaffId}
      />

      <StaffOnboardDialog
        open={onboardOpen}
        clinicId={effectiveClinicId}
        isSuperadmin={isSuperadmin}
        onClose={() => setOnboardOpen(false)}
      />
      {manageStaffId && (
        <ManageStaffDialog
          staffId={manageStaffId}
          clinicId={effectiveClinicId}
          onClose={() => setManageStaffId(null)}
        />
      )}
      <EditStaffCredentialsDialog
        open={!!editStaffId}
        staffId={editStaffId}
        clinicId={effectiveClinicId}
        onClose={() => setEditStaffId(null)}
        onSaved={() => setEditStaffId(null)}
      />
    </Box>
  )
}

// ============ Staff Directory ============

interface StaffDirectoryPanelProps {
  clinicId?: string
  canManage: boolean
  manageDisabledReason: string
  onManage: (id: string) => void
  onEdit: (id: string) => void
}
function StaffDirectoryPanel({ clinicId, canManage, manageDisabledReason, onManage, onEdit }: StaffDirectoryPanelProps) {
  const { data: staffList, isLoading } = useStaffList(clinicId)
  const { data: teamAssignments } = useTeamAssignments(undefined, clinicId)
  const { data: roleAssignments } = useRoleAssignments(undefined, clinicId)
  const [search, setSearch] = React.useState('')
  const [roleFilter, setRoleFilter] = React.useState('')
  const [teamFilter, setTeamFilter] = React.useState('')

  const allStaff = staffList ?? []
  const teamNamesByStaffId = React.useMemo(() => {
    const byStaff = new Map<string, string[]>()
    for (const assignment of teamAssignments ?? []) {
      const staffId = readTeamAssignmentStaffId(assignment as TeamAssignmentCompat)
      if (!staffId) continue
      if (!readTeamAssignmentActive(assignment as TeamAssignmentCompat)) continue

      const teamName = readTeamAssignmentName(assignment as TeamAssignmentCompat)
      if (!teamName) continue

      const existing = byStaff.get(staffId) ?? []
      if (!existing.includes(teamName)) {
        existing.push(teamName)
        byStaff.set(staffId, existing)
      }
    }
    return byStaff
  }, [teamAssignments])

  const roleLabelsByStaffId = React.useMemo(() => {
    const byStaff = new Map<string, string[]>()
    for (const assignment of roleAssignments ?? []) {
      const staffId = readRoleAssignmentStaffId(assignment as RoleAssignmentCompat)
      if (!staffId) continue
      if (!readRoleAssignmentActive(assignment as RoleAssignmentCompat)) continue

      const roleLabel = readRoleAssignmentLabel(assignment as RoleAssignmentCompat)
      if (!roleLabel) continue

      const existing = byStaff.get(staffId) ?? []
      if (!existing.includes(roleLabel)) {
        existing.push(roleLabel)
        byStaff.set(staffId, existing)
      }
    }
    return byStaff
  }, [roleAssignments])

  const normalizedRows = React.useMemo(
    () =>
      allStaff.map((staff) => ({
        ...staff,
        teams: teamNamesByStaffId.get(staff.id) ?? [],
        teamRoles: roleLabelsByStaffId.get(staff.id) ?? [],
      })),
    [allStaff, teamNamesByStaffId, roleLabelsByStaffId],
  )
  const filtered = React.useMemo(
    () => filterStaffDirectory(normalizedRows, search, roleFilter, teamFilter),
    [normalizedRows, search, roleFilter, teamFilter],
  )
  const uniqueRoles = React.useMemo(() => getUniqueStaffRoles(normalizedRows), [normalizedRows])
  const uniqueTeams = React.useMemo(() => getUniqueStaffTeams(normalizedRows), [normalizedRows])

  React.useEffect(() => {
    if (!teamFilter) return
    const exists = uniqueTeams.some((teamName) => teamName.toLowerCase() === teamFilter.toLowerCase())
    if (!exists) setTeamFilter('')
  }, [teamFilter, uniqueTeams])

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress role="progressbar" aria-label="Loading" size={28} sx={{ color: '#b8621a' }} /></Box>

  return (
    <>
    {/* Filters */}
    <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
      <TextField size="small" placeholder="Search staff..." value={search} onChange={e => setSearch(e.target.value)}
        sx={{ minWidth: 250 }} />
      <FormControl size="small" sx={{ minWidth: 140 }}>
        <InputLabel>Role</InputLabel>
        <Select label="Role" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <MenuItem value="">All Roles</MenuItem>
          {uniqueRoles.map((role) => (
            <MenuItem key={role} value={role} sx={{ textTransform: 'capitalize' }}>
              {humanizeLabel(role)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>Team</InputLabel>
        <Select label="Team" value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
          <MenuItem value="">All Teams</MenuItem>
          {uniqueTeams.map((teamName) => (
            <MenuItem key={teamName} value={teamName}>
              {teamName}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="caption" color="text.secondary">{filtered.length} of {allStaff.length} staff</Typography>
      <Box sx={{ flex: 1 }} />
      <ListExportBar compact title="Staff Directory" subtitle={`${filtered.length} staff`}
        columns={['Name', 'Email', 'Role', 'Team Roles', 'Team']}
        rows={filtered.map((s) => [
          `${s.givenName ?? ''} ${s.familyName ?? ''}`,
          s.email ?? '',
          s.role ?? '',
          (s.teamRoles ?? []).join(' | '),
          (s.teams ?? []).join(' | '),
        ])} />
    </Box>
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
      <TableContainer role="region" aria-label="Data table">
        <Table size="small">
            <TableHead>
            <TableRow sx={{ bgcolor: '#FBF8F5' }}>
              {['Name', 'Email', 'Role', 'Team Roles', 'Team', ''].map(c => (
                <TableCell key={c} sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 12 }}>{c}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {!filtered.length ? (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 3 }}>
                <Typography variant="body2" color="text.secondary">{allStaff.length === 0 ? 'No staff members. Click "Add Staff" to onboard.' : 'No staff matching filters.'}</Typography>
              </TableCell></TableRow>
            ) : (
              filtered.map((s) => {
                const visual = getRoleVisual(s.role)
                return (
                  <TableRow key={s.id} hover>
                    <TableCell sx={{ fontWeight: 500 }}>{s.givenName} {s.familyName}</TableCell>
                    <TableCell sx={{ color: 'text.secondary' }}>{s.email}</TableCell>
                    <TableCell>
                      <Chip
                        label={humanizeLabel(s.role || 'clinician')}
                        size="small"
                        sx={{
                          textTransform: 'capitalize',
                          fontSize: 11,
                          bgcolor: visual.bg,
                          color: visual.fg,
                          border: '1px solid',
                          borderColor: visual.border,
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {s.teamRoles && s.teamRoles.length > 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                          {s.teamRoles.map((roleLabel) => (
                            <Typography key={`${s.id}-${roleLabel}`} variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>
                              {roleLabel}
                            </Typography>
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          Unassigned
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {s.teams && s.teams.length > 0 ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                          {s.teams.map((teamName) => (
                            <Typography key={`${s.id}-${teamName}`} variant="caption" sx={{ display: 'block', lineHeight: 1.35 }}>
                              {teamName}
                            </Typography>
                          ))}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          Unassigned
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => onEdit(s.id)}
                        disabled={!canManage}
                        sx={{ textTransform: 'none', fontSize: 11, color: '#b8621a' }}>Edit</Button>
                      <Button size="small" onClick={() => onManage(s.id)}
                        disabled={!canManage}
                        sx={{ textTransform: 'none', fontSize: 11, color: '#327C8D' }}>Manage</Button>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
    {!canManage && (
      <Alert severity="info" sx={{ mt: 1.5 }}>
        {manageDisabledReason}
      </Alert>
    )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Manage Staff Dialog — unified team + role assignment matrix
// ══════════════════════════════════════════════════════════════════════════════

interface ManageStaffDialogProps { staffId: string; clinicId?: string; onClose: () => void }
function ManageStaffDialog({ staffId, clinicId, onClose }: ManageStaffDialogProps) {
  const qc = useQueryClient()
  const { data: staffList } = useStaffList(clinicId)
  const { data: tree } = useOrgTree(clinicId)
  const { data: clinicalRoles } = useClinicalRoles(clinicId)
  // Fetch assignments scoped to this staff member
  const { data: teamAssignments } = useTeamAssignments(staffId, clinicId)
  const { data: roleAssignments } = useRoleAssignments(staffId, clinicId)
  const { mutateAsync: createTeam } = useCreateTeamAssignment()
  const { mutateAsync: createRole } = useCreateRoleAssignment()
  const { mutateAsync: updateTeam } = useUpdateTeamAssignment()
  const { mutateAsync: updateRole } = useUpdateRoleAssignment()
  const [editingTeamId, setEditingTeamId] = React.useState<string | null>(null)
  const [editingRoleId, setEditingRoleId] = React.useState<string | null>(null)
  const [editEndDate, setEditEndDate] = React.useState('')
  const [saveError, setSaveError] = React.useState<string | null>(null)

  const staff = staffList?.find((s) => s.id === staffId)
  const flatUnits = React.useMemo(() => tree ? flattenUnits(tree) : [], [tree])

  // Assignments — handle both camelCase and snake_case field names from API
  const myTeams: TeamAssignmentCompat[] = (teamAssignments ?? []).filter((a: TeamAssignmentCompat) =>
    (a.staffId ?? a.staff_id) === staffId
  )
  const myRoles: RoleAssignmentCompat[] = (roleAssignments ?? []).filter((a: RoleAssignmentCompat) =>
    (a.staffId ?? a.staff_id) === staffId
  )

  // Add-assignment form state
  const [addType, setAddType] = React.useState<'team' | 'role' | null>(null)
  const [newOrgUnitId, setNewOrgUnitId] = React.useState('')
  const [newRoleId, setNewRoleId] = React.useState('')
  const [newRoleType, setNewRoleType] = React.useState<AssignableRoleType>('primary')
  const [newStart, setNewStart] = React.useState(new Date().toISOString().split('T')[0])
  const [newEnd, setNewEnd] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const roleTypeChoices = ASSIGNABLE_ROLE_TYPES

  const handleAddTeam = async () => {
    if (!newOrgUnitId || !newStart) return
    setSaveError(null)
    setSaving(true)
    try {
      await createTeam({ staffId, orgUnitId: newOrgUnitId, startDate: newStart, endDate: newEnd || null, clinicId })
      await qc.invalidateQueries({ queryKey: staffSettingsKeys.teamAssignments() })
      setAddType(null)
      setNewOrgUnitId('')
      setNewEnd('')
    } catch (err) {
      setSaveError(readStaffApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleAddRole = async () => {
    if (!newOrgUnitId || !newRoleId || !newStart) return
    setSaveError(null)
    const normalizedRoleType = normalizeAssignableRoleType(newRoleType)
    if (!normalizedRoleType) {
      setSaveError(`Unsupported role type "${newRoleType}". Use Primary, Additional, or Delegated.`)
      return
    }
    setSaving(true)
    try {
      await createRole({
        staffId,
        orgUnitId: newOrgUnitId,
        clinicalRoleId: newRoleId,
        roleType: normalizedRoleType,
        startDate: newStart,
        endDate: newEnd || null,
        clinicId,
      })
      await qc.invalidateQueries({ queryKey: staffSettingsKeys.roleAssignments() })
      setAddType(null)
      setNewOrgUnitId('')
      setNewRoleId('')
      setNewEnd('')
      setNewRoleType('primary')
    } catch (err) {
      setSaveError(readStaffApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleEndTeam = async (id: string) => {
    setSaveError(null)
    setSaving(true)
    try {
      await updateTeam({ id, data: { endDate: new Date().toISOString().split('T')[0], isActive: false }, clinicId })
      await qc.invalidateQueries({ queryKey: staffSettingsKeys.teamAssignments() })
    } catch (err) {
      setSaveError(readStaffApiError(err))
    } finally {
      setSaving(false)
    }
  }
  const handleEndRole = async (id: string) => {
    setSaveError(null)
    setSaving(true)
    try {
      await updateRole({ id, data: { endDate: new Date().toISOString().split('T')[0], isActive: false }, clinicId })
      await qc.invalidateQueries({ queryKey: staffSettingsKeys.roleAssignments() })
    } catch (err) {
      setSaveError(readStaffApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveTeamEdit = async (id: string) => {
    setSaveError(null)
    setSaving(true)
    try {
      await updateTeam({ id, data: { endDate: editEndDate || null }, clinicId })
      await qc.invalidateQueries({ queryKey: staffSettingsKeys.teamAssignments() })
      setEditingTeamId(null)
    } catch (err) {
      setSaveError(readStaffApiError(err))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveRoleEdit = async (id: string) => {
    setSaveError(null)
    const normalizedRoleType = normalizeAssignableRoleType(newRoleType)
    if (!normalizedRoleType) {
      setSaveError(`Unsupported role type "${newRoleType}". Use Primary, Additional, or Delegated.`)
      return
    }
    setSaving(true)
    try {
      await updateRole({ id, data: { roleType: normalizedRoleType, endDate: editEndDate || null }, clinicId })
      await qc.invalidateQueries({ queryKey: staffSettingsKeys.roleAssignments() })
      setEditingRoleId(null)
    } catch (err) {
      setSaveError(readStaffApiError(err))
    } finally {
      setSaving(false)
    }
  }

  if (!staff) return null

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700, pb: 0 }}>
        Manage Staff — {staff.givenName} {staff.familyName}
      </DialogTitle>
      <Typography variant="caption" color="text.secondary" sx={{ px: 3, pb: 1 }}>
        {staff.email} | System Role: <Chip label={staff.role || 'clinician'} size="small" sx={{ fontSize: 10, height: 18, textTransform: 'capitalize' }} />
      </Typography>
      <Divider />
      <DialogContent sx={{ pt: 2 }}>
        {saveError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {saveError}
          </Alert>
        )}
        {/* Team Memberships */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2" fontWeight={700} color="#327C8D">Team Memberships</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => { setSaveError(null); setAddType('team'); setNewOrgUnitId(''); setNewEnd('') }}
              sx={{ textTransform: 'none', color: '#327C8D', fontSize: 12 }}>Add Team</Button>
          </Box>

          {myTeams.length === 0 && <Alert severity="info" sx={{ fontSize: 11 }}>Not assigned to any team</Alert>}

          {myTeams.map((t) => {
            const active = t.isActive ?? t.is_active ?? true
            const unitName = t.orgUnitName ?? t.org_unit_name ?? t.orgunitname ?? 'Team'
            const start = t.startDate ?? t.start_date ?? t.startdate ?? ''
            const end = t.endDate ?? t.end_date ?? t.enddate ?? ''
            const isEditing = editingTeamId === t.id
            return (
              <Paper key={t.id} variant="outlined" sx={{ p: 1.5, mb: 1, borderLeft: active ? '3px solid #327C8D' : '3px solid #ccc' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>{unitName}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                      {start} — {end || 'ongoing'}
                    </Typography>
                  </Box>
                  <Chip label={active ? 'Active' : 'Ended'} size="small"
                    sx={{ fontSize: 9, height: 18, bgcolor: active ? '#E8F5E9' : '#eee', color: active ? '#2E7D32' : '#999' }} />
                  {active && (
                    <>
                      <Button size="small" onClick={() => { setEditingTeamId(isEditing ? null : t.id); setEditEndDate(end || '') }}
                        sx={{ fontSize: 10, textTransform: 'none', minWidth: 40, color: '#327C8D' }}>
                        {isEditing ? 'Cancel' : 'Edit'}
                      </Button>
                      <Button size="small" color="warning" onClick={() => handleEndTeam(t.id)} sx={{ fontSize: 10, textTransform: 'none', minWidth: 40 }}>End</Button>
                    </>
                  )}
                </Box>
                {isEditing && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center' }}>
                    <TextField label="End Date" type="date" size="small" value={editEndDate}
                      onChange={e => setEditEndDate(e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 180 }} />
                    <Button size="small" variant="contained" disabled={saving} onClick={() => handleSaveTeamEdit(t.id)}
                      sx={{ bgcolor: '#327C8D', fontSize: 11, textTransform: 'none' }}>Save</Button>
                  </Box>
                )}
              </Paper>
            )
          })}

          {/* Add Team inline form */}
          {addType === 'team' && (
            <Paper variant="outlined" sx={{ p: 2, mt: 1, bgcolor: '#F5F9FA' }}>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 5 }}>
                  <TextField select label="Team / Unit" fullWidth size="small" value={newOrgUnitId} onChange={e => setNewOrgUnitId(e.target.value)}>
                    {flatUnits.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField label="Start" type="date" fullWidth size="small" value={newStart} onChange={e => setNewStart(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                </Grid>
                <Grid size={{ xs: 6, sm: 3 }}>
                  <TextField label="End (opt)" type="date" fullWidth size="small" value={newEnd} onChange={e => setNewEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                </Grid>
                <Grid size={{ xs: 12, sm: 1 }} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                  <Button size="small" variant="contained" disabled={!newOrgUnitId || saving} onClick={handleAddTeam}
                    sx={{ bgcolor: '#327C8D', minWidth: 50, fontSize: 11 }}>Add</Button>
                </Grid>
              </Grid>
            </Paper>
          )}
        </Box>

        <Divider sx={{ mb: 3 }} />

        {/* Role Assignments per Team */}
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2" fontWeight={700} color="#7B1FA2">Role Assignments</Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={() => { setSaveError(null); setAddType('role'); setNewOrgUnitId(''); setNewRoleId(''); setNewEnd(''); setNewRoleType('primary') }}
              sx={{ textTransform: 'none', color: '#7B1FA2', fontSize: 12 }}>Add Role</Button>
          </Box>

          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5, fontSize: 11 }}>
            Staff can hold multiple roles across different teams — primary, additional, or delegated. Each can be clinical or administrative.
          </Typography>

          {myRoles.length === 0 && <Alert severity="info" sx={{ fontSize: 11 }}>No role assignments. Add roles per team for this staff member.</Alert>}

          {myRoles.map((r) => {
            const active = r.isActive ?? r.is_active ?? true
            const roleName = r.clinicalRoleName ?? r.clinical_role_name ?? r.clinicalrolename ?? 'Role'
            const unitName = r.orgUnitName ?? r.org_unit_name ?? r.orgunitname ?? ''
            const rawRoleType = r.roleType ?? r.role_type ?? r.roletype ?? 'primary'
            const normalizedRoleType = normalizeAssignableRoleType(rawRoleType) ?? 'additional'
            const start = r.startDate ?? r.start_date ?? r.startdate ?? ''
            const end = r.endDate ?? r.end_date ?? r.enddate ?? ''
            const isEditing = editingRoleId === r.id
            return (
              <Paper key={r.id} variant="outlined" sx={{ p: 1.5, mb: 1, borderLeft: active ? '3px solid #7B1FA2' : '3px solid #ccc' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                  <Box sx={{ flex: 1, minWidth: 200 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 13 }}>{roleName}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                      {unitName} | {start} — {end || 'ongoing'}
                    </Typography>
                  </Box>
                  <Chip label={normalizedRoleType} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize',
                    bgcolor: normalizedRoleType === 'primary' ? '#327C8D' : normalizedRoleType === 'delegated' ? '#b8621a' : '#eee',
                    color: normalizedRoleType === 'primary' || normalizedRoleType === 'delegated' ? '#fff' : '#555' }} />
                  <Chip label={active ? 'Active' : 'Ended'} size="small"
                    sx={{ fontSize: 9, height: 18, bgcolor: active ? '#E8F5E9' : '#eee', color: active ? '#2E7D32' : '#999' }} />
                  {active && (
                    <>
                      <Button size="small" onClick={() => {
                        setSaveError(null)
                        setEditingRoleId(isEditing ? null : r.id)
                        setEditEndDate(end || '')
                        setNewRoleType(normalizedRoleType)
                      }}
                        sx={{ fontSize: 10, textTransform: 'none', minWidth: 40, color: '#7B1FA2' }}>
                        {isEditing ? 'Cancel' : 'Edit'}
                      </Button>
                      <Button size="small" color="warning" onClick={() => handleEndRole(r.id)} sx={{ fontSize: 10, textTransform: 'none', minWidth: 40 }}>End</Button>
                    </>
                  )}
                </Box>
                {isEditing && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <TextField select label="Role Type" size="small" value={newRoleType} onChange={e => setNewRoleType(e.target.value as AssignableRoleType)} sx={{ width: 150 }}>
                      {roleTypeChoices.map((t) => (
                        <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>
                      ))}
                    </TextField>
                    <TextField label="End Date" type="date" size="small" value={editEndDate}
                      onChange={e => setEditEndDate(e.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }} sx={{ width: 160 }} />
                    <Button size="small" variant="contained" disabled={saving} onClick={() => handleSaveRoleEdit(r.id)}
                      sx={{ bgcolor: '#7B1FA2', fontSize: 11, textTransform: 'none' }}>Save</Button>
                  </Box>
                )}
              </Paper>
            )
          })}

          {/* Add Role inline form */}
          {addType === 'role' && (
            <Paper variant="outlined" sx={{ p: 2, mt: 1, bgcolor: '#F5F0FA' }}>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField select label="Team / Unit" fullWidth size="small" value={newOrgUnitId} onChange={e => setNewOrgUnitId(e.target.value)}>
                    {flatUnits.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField select label="Clinical Role" fullWidth size="small" value={newRoleId} onChange={e => setNewRoleId(e.target.value)}>
                    {clinicalRoles?.map((r: ClinicalRole) => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, sm: 4 }}>
                  <TextField select label="Type" fullWidth size="small" value={newRoleType} onChange={e => setNewRoleType(e.target.value as AssignableRoleType)}>
                    {roleTypeChoices.map((t) => (
                      <MenuItem key={t} value={t} sx={{ textTransform: 'capitalize' }}>{t}</MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, sm: 4 }}>
                  <TextField label="Start Date" type="date" fullWidth size="small" value={newStart} onChange={e => setNewStart(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                </Grid>
                <Grid size={{ xs: 6, sm: 4 }}>
                  <TextField label="End Date (optional)" type="date" fullWidth size="small" value={newEnd} onChange={e => setNewEnd(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
                </Grid>
                <Grid size={{ xs: 12, sm: 4 }} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Button size="small" onClick={() => { setSaveError(null); setAddType(null) }} sx={{ textTransform: 'none', color: 'text.secondary' }}>Cancel</Button>
                  <Button size="small" variant="contained" disabled={!newOrgUnitId || !newRoleId || saving} onClick={handleAddRole}
                    sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' }, fontSize: 11 }}>Add Role</Button>
                </Grid>
              </Grid>
            </Paper>
          )}
        </Box>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button onClick={onClose} variant="outlined" sx={{ textTransform: 'none' }}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

export default StaffAssignmentsPage

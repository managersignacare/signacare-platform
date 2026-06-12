/**
 * ModuleAccessMatrix — single source of truth for the clinic-admin
 * staff × module access grid.
 *
 * This component is the ONE surface that reads and writes
 * staff_module_access rows. It is mounted in exactly one place:
 * the "Access Control" tab inside Power Settings. The duplicate
 * AccessControlPanel that used to live in SettingsPage.tsx (with
 * a stale hardcoded MODULES list and a 'view'/'admin'/'none'
 * access-level enum the middleware rejected) has been deleted,
 * and the standalone /staff-module-access page has been retired.
 *
 * Renders one row per active staff member and one column per
 * canonical module key (delivered by the backend). Each cell is
 * a three-way selector: No access / Read only / Read + write.
 * Mutations are optimistic and invalidate the matrix query key on
 * success. Admins and superadmins bypass the middleware on the
 * backend — their rows render a 'Bypass' chip instead of editable
 * cells so the operator isn't misled. A non-superadmin admin
 * cannot edit their own row (self-lockout protection mirrored
 * from the backend CANNOT_EDIT_OWN_GRANTS guard).
 */
import {
  Alert,
  Box,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { apiClient } from '../../../shared/services/apiClient'
import { useAuthStore } from '../../../shared/store/authStore'
import { staffSettingsKeys } from '../queryKeys'

type AccessLevel = 'none' | 'read' | 'write'

interface StaffGrant {
  module: string
  accessLevel: 'read' | 'write' | 'full'
  canDelegate: boolean
}

interface StaffRow {
  id: string
  givenName: string
  familyName: string
  email: string
  role: string
  grants: StaffGrant[]
}

interface MatrixResponse {
  staff: StaffRow[]
  moduleKeys: string[]
  total?: number
  page?: number
  limit?: number
}

// Human-readable labels for every canonical module key. Any module
// key missing from this map falls back to a humanised version of
// the raw key, so adding a new module to apps/api/src/shared/
// moduleKeys.ts still renders — add an entry here when you want a
// nicer label.
const MODULE_LABELS: Record<string, string> = {
  // New (enforced) modules
  imports: 'Bulk imports',
  'patient-allocations': 'Patient re-allocations',
  'medical-scribe': 'Medical scribe',
  'agentic-ai-scribe': 'Agentic AI scribe (next-gen)',
  ai: 'AI (suggestions, summaries)',
  'ai-agent': 'AI agent (autonomous)',
  pathways: 'Pathways',
  // Legacy (management-only) modules — snake_case to match the DB
  advance_directives: 'Advance directives',
  appointments: 'Appointments',
  audit: 'Audit log',
  beds: 'Bed board',
  billing: 'Billing',
  carers: 'Carers',
  clinical_notes: 'Clinical notes',
  clozapine: 'Clozapine',
  correspondence: 'Correspondence',
  ect: 'ECT',
  episodes: 'Episodes',
  escalations: 'Escalations',
  group_therapy: 'Group therapy',
  lai: 'LAI',
  legal_orders: 'Legal orders (MHA)',
  medications: 'Medications',
  messages: 'Messages',
  nursing_assessments: 'Nursing assessments',
  outcomes: 'Outcomes',
  pathology: 'Pathology',
  patients: 'Patients',
  prescriptions: 'Prescriptions',
  referrals: 'Referrals',
  reports: 'Reports',
  risk_assessments: 'Risk assessments',
  safety_plans: 'Safety plans',
  settings: 'Settings',
  tasks: 'Tasks',
  templates: 'Templates',
  tms: 'TMS',
  voice: 'Voice notes',
}

function humanise(key: string): string {
  const existing = MODULE_LABELS[key]
  if (existing) return existing
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

const BYPASS_ROLES = new Set(['admin', 'superadmin'])

function normaliseLevel(level: StaffGrant['accessLevel']): AccessLevel {
  // Legacy 'full' collapses to 'write' in the UI so the tri-state
  // selector has one "has write access" value. The backend accepts
  // 'full' on the round-trip so pre-existing rows are preserved.
  if (level === 'read') return 'read'
  return 'write'
}

function buildLevelMap(
  grants: StaffGrant[],
  moduleKeys: string[],
): Record<string, AccessLevel> {
  const map: Record<string, AccessLevel> = {}
  for (const key of moduleKeys) map[key] = 'none'
  for (const g of grants) {
    if (moduleKeys.includes(g.module)) {
      map[g.module] = normaliseLevel(g.accessLevel)
    }
  }
  return map
}

export interface ModuleAccessMatrixProps {
  /**
   * Visual shell. 'page' renders a full-page header + tinted
   * background — use when the component is the entire route body.
   * 'tab' renders naked so it slots inside a Power Settings tab
   * without doubling up typography or pastel backgrounds.
   */
  variant?: 'page' | 'tab'
}

export const ModuleAccessMatrix: React.FC<ModuleAccessMatrixProps> = ({
  variant = 'tab',
}) => {
  const qc = useQueryClient()
  const authUser = useAuthStore((s) => s.user)
  const currentStaffId = authUser?.id ?? ''
  const currentRole = authUser?.role ?? ''
  const [searchTerm, setSearchTerm] = React.useState('')
  const [page, setPage] = React.useState(0)
  const [rowsPerPage, setRowsPerPage] = React.useState(25)
  const deferredSearch = React.useDeferredValue(searchTerm.trim())

  const { data, isLoading, isError, error } = useQuery<MatrixResponse>({
    queryKey: staffSettingsKeys.moduleAccessMatrixPage({
      page: page + 1,
      limit: rowsPerPage,
      q: deferredSearch,
    }),
    queryFn: () =>
      apiClient.get<MatrixResponse>('staff-settings/module-access', {
        page: page + 1,
        limit: rowsPerPage,
        q: deferredSearch.length > 0 ? deferredSearch : undefined,
      }),
  })

  // Phase 0.5.C — read-only fallback flag. When a PUT/DELETE returns
  // 403 ACCESS_SETTINGS_READ_ONLY (the settings rail introduced in
  // 0.5.B), flip the grid into view-only and surface a banner
  // explaining the access-administrator concept. All other 403s
  // (existing CANNOT_EDIT_OWN_GRANTS etc.) keep their original
  // modal/inline handling.
  const [readOnlyReason, setReadOnlyReason] = React.useState<string | null>(null);

  const saveMut = useMutation({
    mutationFn: async (input: {
      staffId: string
      module: string
      accessLevel: AccessLevel
    }) => {
      // The backend PUT merges on (staff_id, module) rather than
      // replacing the whole grant list, so we only need to send
      // the single row being edited. 'none' is a revoke — DELETE
      // on the specific (staffId, module) row.
      if (input.accessLevel === 'none') {
        await apiClient.delete(
          `staff-settings/module-access/${input.staffId}/${input.module}`,
        )
        return
      }
      await apiClient.put(`staff-settings/module-access/${input.staffId}`, {
        modules: [{ module: input.module, accessLevel: input.accessLevel }],
      })
    },
    onSuccess: () => {
      // L5-absorb-1: clear sticky banner on successful save — user may
      // have just regained authority (superadmin re-nominated them).
      setReadOnlyReason(null);
      qc.invalidateQueries({ queryKey: staffSettingsKeys.moduleAccessMatrix() })
    },
    onError: (err: { response?: { status?: number; data?: { code?: string; error?: string } } }) => {
      if (err?.response?.status === 403 && err.response.data?.code === 'ACCESS_SETTINGS_READ_ONLY') {
        setReadOnlyReason(
          (err.response.data.error ?? 'You can view but not change access settings.')
          + ' Contact your clinic\'s nominated or delegated admin to request a change.',
        );
      }
    },
  })

  if (isLoading) {
    return (
      <Box sx={{ p: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (isError) {
    return (
      <Box sx={{ p: variant === 'page' ? 4 : 0, pt: 2 }}>
        <Alert severity="error">
          Could not load the access matrix:{' '}
          {error instanceof Error ? error.message : String(error)}
        </Alert>
      </Box>
    )
  }

  const staff = data?.staff ?? []
  const moduleKeys = data?.moduleKeys ?? []
  const totalFiltered = data?.total ?? staff.length
  const pagedStaff = staff

  React.useEffect(() => {
    if (totalFiltered <= 0) {
      if (page !== 0) setPage(0)
      return
    }
    const maxPage = Math.max(0, Math.ceil(totalFiltered / rowsPerPage) - 1)
    if (page > maxPage) setPage(maxPage)
  }, [page, rowsPerPage, totalFiltered])

  // Phase 0.5.C — surface the read-only fallback banner above the grid
  // when a mutation has been rejected with ACCESS_SETTINGS_READ_ONLY.
  // The existing `saveMut.mutate` calls at the <Select> sites flow
  // through onError, which sets readOnlyReason. Subsequent edits are
  // still attempted (onError isn't a hard disable) — the BACKEND is
  // the authoritative reject; this banner is the UX signal.
  const readOnlyBanner = readOnlyReason ? (
    <Alert severity="warning" sx={{ mb: 2 }}>
      {readOnlyReason}
    </Alert>
  ) : null;

  const header =
    variant === 'page' ? (
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} sx={{ color: '#3D484B' }}>
          Module access
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Control which staff can use each feature. Changes apply to the next request — no
          logout required.
        </Typography>
      </Box>
    ) : (
      <Box sx={{ mb: 2 }}>
        <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>
          Staff access control
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Control which staff can use each feature. Changes apply to the next request — no
          logout required.
        </Typography>
      </Box>
    )

  const matrix = (
    <>
      {readOnlyBanner}
      <Alert severity="info" sx={{ mb: 2 }}>
        Admins and superadmins bypass this matrix on the server — their rows are read-only
        here. To revoke a feature from an admin, change their role first.
      </Alert>

      <Box
        sx={{
          mb: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <TextField
          size="small"
          label="Search staff"
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value)
            setPage(0)
          }}
          placeholder="Name, email, role"
          sx={{ minWidth: 280, bgcolor: 'background.paper' }}
        />
        <Typography variant="body2" color="text.secondary">
          Showing {pagedStaff.length} of {totalFiltered} staff
        </Typography>
      </Box>

      <Paper sx={{ overflow: 'auto' }}>
        <TableContainer>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, minWidth: 200 }}>Staff</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Role</TableCell>
                {moduleKeys.map((key) => (
                  <TableCell key={key} sx={{ fontWeight: 600, minWidth: 160 }}>
                    {humanise(key)}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {pagedStaff.length === 0 && (
                <TableRow>
                  <TableCell colSpan={moduleKeys.length + 2} sx={{ py: 3, textAlign: 'center' }}>
                    <Typography variant="body2" color="text.secondary">
                      No staff matched this filter.
                    </Typography>
                  </TableCell>
                </TableRow>
              )}
              {pagedStaff.map((s) => {
                const levels = buildLevelMap(s.grants, moduleKeys)
                const isBypass = BYPASS_ROLES.has(s.role)
                const isSelf =
                  s.id === currentStaffId && currentRole !== 'superadmin'
                const disabled = isBypass || isSelf
                return (
                  <TableRow key={s.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {s.familyName}, {s.givenName}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {s.email}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip label={s.role} size="small" />
                    </TableCell>
                    {moduleKeys.map((key) => {
                      const cell = (
                        <Select
                          size="small"
                          value={levels[key]}
                          disabled={disabled || saveMut.isPending}
                          onChange={(e) => {
                            const next = e.target.value as AccessLevel
                            saveMut.mutate({
                              staffId: s.id,
                              module: key,
                              accessLevel: next,
                            })
                          }}
                          sx={{ minWidth: 110 }}
                        >
                          <MenuItem value="none">No access</MenuItem>
                          <MenuItem value="read">Read only</MenuItem>
                          <MenuItem value="write">Read + write</MenuItem>
                        </Select>
                      )
                      return (
                        <TableCell key={key}>
                          {isBypass ? (
                            <Tooltip title="Admins bypass the matrix — set by role">
                              <Chip
                                label="Bypass"
                                size="small"
                                color="primary"
                                variant="outlined"
                              />
                            </Tooltip>
                          ) : isSelf ? (
                            <Tooltip title="Admins cannot edit their own grants — ask another admin">
                              <span>{cell}</span>
                            </Tooltip>
                          ) : (
                            cell
                          )}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <TablePagination
          component="div"
          count={totalFiltered}
          page={page}
          onPageChange={(_event, nextPage) => setPage(nextPage)}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={(event) => {
            setRowsPerPage(parseInt(event.target.value, 10))
            setPage(0)
          }}
          rowsPerPageOptions={[10, 25, 50]}
        />
      </Paper>

      {saveMut.isError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          Save failed:{' '}
          {saveMut.error instanceof Error
            ? saveMut.error.message
            : String(saveMut.error)}
        </Alert>
      )}
    </>
  )

  if (variant === 'page') {
    return (
      <Box
        sx={{
          px: { xs: 2, sm: 3, md: 4 },
          py: 3,
          bgcolor: '#FBF8F5',
          minHeight: '100vh',
        }}
      >
        {header}
        {matrix}
      </Box>
    )
  }
  return (
    <Box>
      {header}
      {matrix}
    </Box>
  )
}

export default ModuleAccessMatrix

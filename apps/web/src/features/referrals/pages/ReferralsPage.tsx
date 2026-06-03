// apps/web/src/features/referrals/pages/ReferralsPage.tsx — Intake Module
import AddIcon from '@mui/icons-material/Add'
import AttachFileIcon from '@mui/icons-material/AttachFile'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import DeleteIcon from '@mui/icons-material/Delete'
import PersonAddIcon from '@mui/icons-material/PersonAdd'
import SearchIcon from '@mui/icons-material/Search'
import {
    Alert,
    Box,
    Button, Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    Grid,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    Tab,
    Tabs,
    TextField,
    Typography
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import React, { useState } from 'react'
import { ALL_SPECIALTIES, SPECIALTY_DISPLAY, type SpecialtyType } from '@signacare/shared'
import { ListExportBar } from '../../../shared/components/ui/ListExportBar'
import { apiClient } from '../../../shared/services/apiClient'
import { useOrgTree } from '../../org-settings/hooks/useOrgSettings'
import type { OrgUnit } from '../../org-settings/services/orgSettingsApi'
import { PatientRegistrationWizard } from '../../patients/components/registration/PatientRegistrationWizard'
import { PatientSearchAutocomplete, type PatientOption } from '../../patients/components/PatientSearchAutocomplete'
import { useReferralSources, useRoleAssignments } from '../../staff-settings/hooks/useStaffSettings'
import { ReferralSection } from '../components/ReferralSection'
import { referralKeys, referralsCrossFeatureKeys } from '../queryKeys'
import {
  PERIOD_OPTIONS,
  isAcceptedReferralStatus,
  isActiveIntakeReferralStatus,
  isRejectedReferralStatus,
  periodToDateRange,
  readApiError,
} from '../utils/referralsUiHelpers'

// Types
interface Referral {
  id: string
  referralNumber: string
  referralDate: string
  source: string
  fromService: string
  fromProviderName: string | null
  reason: string
  urgency: string
  status: string
  patientId: string | null
  patientGivenName?: string
  patientFamilyName?: string
  patientDob?: string
  hasAttachment: boolean
  createdAt: string
}

// API
function useReferrals(filters: Record<string, unknown>) {
  return useQuery({
    queryKey: referralKeys.list(filters),
    queryFn: () => apiClient.get<{ items: Referral[]; total: number }>('referrals', filters),
    staleTime: 15_000,
  })
}

function useCreateReferral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => apiClient.post<Referral>('referrals', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.all }),
  })
}

function useUpdateReferralStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      apiClient.patch<Referral>(`referrals/${id}`, { status, notes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.all }),
  })
}

function useDecideReferral() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      decision,
      notes,
      createEpisode,
      episodeType,
      isExternalTarget,
      confirmDecision,
      declineReason,
      decisionReasonCategory,
    }: {
      id: string;
      decision: string;
      notes?: string;
      createEpisode?: boolean;
      episodeType?: string;
      isExternalTarget?: boolean;
      confirmDecision?: boolean;
      declineReason?: string;
      decisionReasonCategory?: string;
    }) =>
      apiClient.post<Referral & { linkedEpisodeId?: string }>(`referrals/${id}/decision`, {
        decision,
        notes,
        createEpisode,
        episodeType,
        isExternalTarget,
        confirmDecision,
        declineReason,
        decisionReasonCategory,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.all }),
  })
}

function useAllocate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { referralId: string; episodeId: string; orgUnitId: string; primaryClinicianId?: string; consultantId?: string; juniorMedicalId?: string; clinicalSpecialistId?: string; keyWorkerId?: string }) =>
      apiClient.post(`referrals/${data.referralId}/allocate`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: referralKeys.all }),
  })
}

interface FlatOrgUnit {
  id: string
  name: string
  clinicId: string
}

interface StaffLookupOption {
  id: string
  givenName: string
  familyName: string
  discipline: string | null
}

const ALLOCATION_ROLE_KEYWORDS = {
  keyClinician: ['key clinician', 'key worker', 'primary clinician'],
  consultantPsychiatrist: ['consultant psychiatrist'],
  juniorMedical: ['psychiatry registrar', 'junior medical', 'registrar', 'rmo', 'resident', 'intern'],
  clinicalSpecialist: ['senior clinician', 'clinical specialist'],
} as const

function flattenUnits(nodes: OrgUnit[]): FlatOrgUnit[] {
  const result: FlatOrgUnit[] = []
  function walk(list: OrgUnit[], depth: number) {
    for (const n of list) {
      result.push({ id: n.id, name: '\u00A0'.repeat(depth * 2) + n.name, clinicId: n.clinicId })
      if (n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(nodes, 0)
  return result
}

const URGENCY_OPTIONS = [
  { value: 'emergency', label: 'Emergency' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'soon', label: 'Soon' },
  { value: 'routine', label: 'Routine' },
]

// ============ Main Page ============

export default function ReferralsPage() {
  const [search, setSearch] = useState('')
  const [period, setPeriod] = useState('all')
  const [teamFilter, setTeamFilter] = useState('')
  const [subTab, setSubTab] = useState<'active' | 'accepted' | 'rejected'>('active')
  const [newOpen, setNewOpen] = useState(false)
  const [allocateReferral, setAllocateReferral] = useState<Referral | null>(null)
  const [allocateEpisodeId, setAllocateEpisodeId] = useState('')
  const { mutateAsync: decide } = useDecideReferral()
  const { mutateAsync: updateStatus } = useUpdateReferralStatus()
  const { data: tree } = useOrgTree()
  const flatUnits = React.useMemo(() => tree ? flattenUnits(tree) : [], [tree])

  const dateRange = React.useMemo(() => periodToDateRange(period), [period])

  // Fetch all referrals (no status filter — we split client-side into 3 sections)
  const { data, isLoading } = useReferrals({
    direction: 'intake',
    search: search || undefined,
    ...dateRange,
    page: 1,
    pageSize: 100,
  })

  // Split into 3 sections + apply team filter
  const allItems = React.useMemo(() => {
    let items = data?.items ?? []
    if (teamFilter) {
      items = items.filter(r => (r.source || r.fromService || '').toLowerCase().includes(teamFilter.toLowerCase()))
    }
    return items
  }, [data, teamFilter])

  const activeReferrals = React.useMemo(
    () => allItems.filter((r) => isActiveIntakeReferralStatus(r.status)),
    [allItems],
  )
  const acceptedReferrals = React.useMemo(
    () => allItems.filter((r) => isAcceptedReferralStatus(r.status)),
    [allItems],
  )
  const rejectedReferrals = React.useMemo(
    () => allItems.filter((r) => isRejectedReferralStatus(r.status)),
    [allItems],
  )

  const handleAccept = async (r: Referral) => {
    const confirmed = window.confirm(`Accept referral ${r.referralNumber}?`);
    if (!confirmed) return;
    try {
      const result = await decide({
        id: r.id,
        decision: 'accepted',
        confirmDecision: true,
        createEpisode: true,
        episodeType: 'community',
      })
      if (result?.linkedEpisodeId) { setAllocateEpisodeId(result.linkedEpisodeId); setAllocateReferral(r) }
    } catch (err) { alert(`Could not accept referral: ${readApiError(err)}`) }
  }
  const handleAcceptExt = async (r: Referral) => {
    const confirmed = window.confirm(`Accept referral ${r.referralNumber} for external target?`);
    if (!confirmed) return;
    try {
      await decide({
        id: r.id,
        decision: 'accepted',
        confirmDecision: true,
        isExternalTarget: true,
      })
    }
    catch (err) { alert(`Could not accept referral: ${readApiError(err)}`) }
  }
  const handleReject = async (r: Referral) => {
    const reason = window.prompt(`Decline referral ${r.referralNumber}: provide reason`);
    if (!reason || !reason.trim()) return;
    const confirmed = window.confirm(`Confirm decline of referral ${r.referralNumber}?`);
    if (!confirmed) return;
    try {
      await decide({
        id: r.id,
        decision: 'declined',
        confirmDecision: true,
        declineReason: reason.trim(),
      })
    }
    catch (err) { alert(`Could not reject referral: ${readApiError(err)}`) }
  }

  // Unique teams from data for filter dropdown
  const teamOptions = React.useMemo(() => {
    const teams = new Set<string>()
    for (const r of data?.items ?? []) {
      const t = r.source || r.fromService
      if (t) teams.add(t)
    }
    return Array.from(teams).sort()
  }, [data])

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', mb: 3, gap: 2, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B' }}>
            Intake
          </Typography>
          <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mt: 0.5 }}>
            Manage incoming referrals — review, accept, or redirect
          </Typography>
        </Box>
        <Button startIcon={<AddIcon />} variant="contained" onClick={() => setNewOpen(true)}
          sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          Add Intake Referral
        </Button>
      </Box>

      {/* Filters */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        <TextField size="small" placeholder="Search by name, referral #…" value={search} onChange={e => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 20, color: 'text.secondary' }} /></InputAdornment> } }}
          sx={{ minWidth: 240, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }} />
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>Period</InputLabel>
          <Select value={period} onChange={e => setPeriod(e.target.value)} label="Period" sx={{ bgcolor: '#fff' }}>
            {PERIOD_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 200 }}>
          <InputLabel>Team / Source</InputLabel>
          <Select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} label="Team / Source" sx={{ bgcolor: '#fff' }}>
            <MenuItem value="">All Teams</MenuItem>
            {teamOptions.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
            {flatUnits.filter(u => !teamOptions.includes(u.name.trim())).map(u => <MenuItem key={u.id} value={u.name.trim()}>{u.name}</MenuItem>)}
          </Select>
        </FormControl>
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <ListExportBar compact title="Intake / Referrals" subtitle={`${allItems.length} records`}
          columns={['Patient', 'DOB', 'Referral #', 'Date', 'Source', 'Urgency', 'Status']}
          rows={allItems.map((r) => [
            `${r.patientFamilyName ?? ''}, ${r.patientGivenName ?? ''}`,
            r.patientDob ? new Date(r.patientDob).toLocaleDateString('en-AU') : '',
            r.referralNumber ?? '', r.referralDate ? new Date(r.referralDate).toLocaleDateString('en-AU') : '',
            r.source ?? r.fromService ?? '', r.urgency ?? '', r.status ?? '',
          ])} />
      </Box>

      {/* Sub-tabs */}
      <Tabs
        value={subTab}
        onChange={(_, v) => setSubTab(v)}
        sx={{
          mb: 2, borderBottom: '1px solid', borderColor: 'divider',
          '& .MuiTab-root': { textTransform: 'none', fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, fontSize: 13, minHeight: 40 },
          '& .Mui-selected': { fontWeight: 700 },
        }}
      >
        <Tab value="active" label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            Active Referrals
            <Chip label={activeReferrals.length} size="small" color="warning" sx={{ fontSize: 10, height: 18, fontWeight: 700 }} />
          </Box>
        } />
        <Tab value="accepted" label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            Accepted
            <Chip label={acceptedReferrals.length} size="small" color="success" sx={{ fontSize: 10, height: 18, fontWeight: 700 }} />
          </Box>
        } />
        <Tab value="rejected" label={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            Rejected
            <Chip label={rejectedReferrals.length} size="small" color="error" sx={{ fontSize: 10, height: 18, fontWeight: 700 }} />
          </Box>
        } />
      </Tabs>

      {subTab === 'active' && (
        <ReferralSection
          title="Active Referrals" color="#FFF8E1" chipColor="warning"
          items={activeReferrals} isLoading={isLoading} showActions
          onReview={(id) => updateStatus({ id, status: 'under_review' })}
          onAccept={handleAccept} onAcceptExt={handleAcceptExt} onReject={handleReject}
        />
      )}

      {subTab === 'accepted' && (
        <ReferralSection
          title="Completed — Accepted" color="#E8F5E9" chipColor="success"
          items={acceptedReferrals} isLoading={isLoading}
        />
      )}

      {subTab === 'rejected' && (
        <ReferralSection
          title="Completed — Rejected" color="#FDECEA" chipColor="error"
          items={rejectedReferrals} isLoading={isLoading}
        />
      )}

      <NewReferralDialog open={newOpen} onClose={() => setNewOpen(false)} />

      {allocateReferral && (
        <AllocationDialog
          open
          referralId={allocateReferral.id}
          episodeId={allocateEpisodeId}
          onClose={() => { setAllocateReferral(null); setAllocateEpisodeId('') }}
        />
      )}
    </Box>
  )
}

// ============ Allocation Dialog ============

interface AllocationDialogProps { open: boolean; referralId: string; episodeId: string; onClose: () => void }
function AllocationDialog({ open, referralId, episodeId, onClose }: AllocationDialogProps) {
  // Allocation is mandatory — the dialog cannot be dismissed without assigning a team.
  // The intake episode only closes once allocation succeeds.
  const { data: tree } = useOrgTree()
  const { mutateAsync: allocate, isPending } = useAllocate()

  const [orgUnitId, setOrgUnitId] = useState('')
  const [primaryClinicianId, setPrimaryClinicianId] = useState('')
  const [consultantId, setConsultantId] = useState('')
  const [juniorMedicalId, setJuniorMedicalId] = useState('')
  const [clinicalSpecialistId, setClinicalSpecialistId] = useState('')

  const flatUnits = React.useMemo(() => tree ? flattenUnits(tree) : [], [tree])
  const selectedClinicId = React.useMemo(
    () => flatUnits.find((unit) => unit.id === orgUnitId)?.clinicId,
    [flatUnits, orgUnitId],
  )

  // Staff lookup
  const { data: staffList } = useQuery({
    queryKey: referralsCrossFeatureKeys.staffLookup(selectedClinicId),
    queryFn: () =>
      apiClient.get<StaffLookupOption[]>(
        'staff/lookup',
        selectedClinicId ? { clinicId: selectedClinicId } : undefined,
      ),
    staleTime: 5 * 60 * 1000,
  })
  const staffOptions = staffList ?? []

  const { data: roleAssignments } = useRoleAssignments(undefined, selectedClinicId)

  React.useEffect(() => {
    if (staffOptions.length === 0) {
      setPrimaryClinicianId('')
      setConsultantId('')
      setJuniorMedicalId('')
      setClinicalSpecialistId('')
      return
    }
    const validStaffIds = new Set(staffOptions.map((staff) => staff.id))
    setPrimaryClinicianId((current) => (current && !validStaffIds.has(current) ? '' : current))
    setConsultantId((current) => (current && !validStaffIds.has(current) ? '' : current))
    setJuniorMedicalId((current) => (current && !validStaffIds.has(current) ? '' : current))
    setClinicalSpecialistId((current) => (current && !validStaffIds.has(current) ? '' : current))
  }, [staffOptions])

  const activeRoleNamesByStaff = React.useMemo(() => {
    const now = new Date()
    const roleMap = new Map<string, Set<string>>()
    for (const assignment of roleAssignments ?? []) {
      if (!assignment.isActive) continue
      if (assignment.endDate) {
        const endDate = new Date(assignment.endDate)
        if (!Number.isNaN(endDate.getTime()) && endDate < now) continue
      }
      const normalizedRoleName = assignment.clinicalRoleName.trim().toLowerCase()
      if (!normalizedRoleName) continue
      const names = roleMap.get(assignment.staffId) ?? new Set<string>()
      names.add(normalizedRoleName)
      roleMap.set(assignment.staffId, names)
    }
    return roleMap
  }, [roleAssignments])

  const filterStaffByRoleKeywords = React.useCallback(
    (keywords: readonly string[]) => {
      if (keywords.length === 0) return staffOptions
      return staffOptions.filter((staff) => {
        const roleNames = activeRoleNamesByStaff.get(staff.id)
        if (!roleNames || roleNames.size === 0) return false
        for (const roleName of roleNames) {
          if (keywords.some((keyword) => roleName.includes(keyword))) {
            return true
          }
        }
        return false
      })
    },
    [activeRoleNamesByStaff, staffOptions],
  )

  const includeSelectedStaff = React.useCallback(
    (options: StaffLookupOption[], selectedId: string) => {
      if (!selectedId) return options
      if (options.some((staff) => staff.id === selectedId)) return options
      const selectedStaff = staffOptions.find((staff) => staff.id === selectedId)
      return selectedStaff ? [selectedStaff, ...options] : options
    },
    [staffOptions],
  )

  const primaryClinicianOptions = React.useMemo(
    () => includeSelectedStaff(filterStaffByRoleKeywords(ALLOCATION_ROLE_KEYWORDS.keyClinician), primaryClinicianId),
    [filterStaffByRoleKeywords, includeSelectedStaff, primaryClinicianId],
  )
  const consultantOptions = React.useMemo(
    () => includeSelectedStaff(filterStaffByRoleKeywords(ALLOCATION_ROLE_KEYWORDS.consultantPsychiatrist), consultantId),
    [consultantId, filterStaffByRoleKeywords, includeSelectedStaff],
  )
  const juniorMedicalOptions = React.useMemo(
    () => includeSelectedStaff(filterStaffByRoleKeywords(ALLOCATION_ROLE_KEYWORDS.juniorMedical), juniorMedicalId),
    [filterStaffByRoleKeywords, includeSelectedStaff, juniorMedicalId],
  )
  const clinicalSpecialistOptions = React.useMemo(
    () => includeSelectedStaff(filterStaffByRoleKeywords(ALLOCATION_ROLE_KEYWORDS.clinicalSpecialist), clinicalSpecialistId),
    [clinicalSpecialistId, filterStaffByRoleKeywords, includeSelectedStaff],
  )
  const handleAllocate = async () => {
    if (!orgUnitId) return
    await allocate({
      referralId,
      episodeId,
      orgUnitId,
      primaryClinicianId: primaryClinicianId || undefined,
      consultantId: consultantId || undefined,
      juniorMedicalId: juniorMedicalId || undefined,
      clinicalSpecialistId: clinicalSpecialistId || undefined,
    })
    onClose()
  }

  return (
    <Dialog aria-labelledby="dialog-title" open={open} maxWidth="sm" fullWidth disableEscapeKeyDown>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        Allocate to Care Team
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Referral accepted. You <strong>must</strong> assign the patient to a target team to complete the referral.
        </Typography>
        <Typography variant="caption" color="warning.main" sx={{ mb: 2, display: 'block' }}>
          The intake episode will remain open until a team is allocated.
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12 }}>
            <FormControl fullWidth size="small" required>
              <InputLabel>Team / Unit *</InputLabel>
              <Select value={orgUnitId} onChange={e => setOrgUnitId(e.target.value)} label="Team / Unit *">
                {flatUnits.map(u => <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Key Clinician</InputLabel>
              <Select value={primaryClinicianId} onChange={e => setPrimaryClinicianId(e.target.value)} label="Key Clinician">
                <MenuItem value="">—</MenuItem>
                {primaryClinicianOptions.map((s) => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Consultant Psychiatrist</InputLabel>
              <Select value={consultantId} onChange={e => setConsultantId(e.target.value)} label="Consultant Psychiatrist">
                <MenuItem value="">—</MenuItem>
                {consultantOptions.map((s) => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Junior Medical Staff</InputLabel>
              <Select value={juniorMedicalId} onChange={e => setJuniorMedicalId(e.target.value)} label="Junior Medical Staff">
                <MenuItem value="">—</MenuItem>
                {juniorMedicalOptions.map((s) => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Clinical Specialist</InputLabel>
              <Select value={clinicalSpecialistId} onChange={e => setClinicalSpecialistId(e.target.value)} label="Clinical Specialist">
                <MenuItem value="">—</MenuItem>
                {clinicalSpecialistOptions.map((s) => <MenuItem key={s.id} value={s.id}>{s.givenName} {s.familyName}</MenuItem>)}
              </Select>
            </FormControl>
          </Grid>
        </Grid>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button variant="contained" onClick={handleAllocate} disabled={isPending || !orgUnitId}
          sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
          {isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : 'Allocate'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ============ New Referral Dialog ============

interface NewReferralDialogProps { open: boolean; onClose: () => void }
function NewReferralDialog({ open, onClose }: NewReferralDialogProps) {
  const { data: sources } = useReferralSources()
  const { data: tree } = useOrgTree()
  const { mutateAsync: create, isPending } = useCreateReferral()

  const [sourceType, setSourceType] = useState('')
  const [sourceDetail, setSourceDetail] = useState('')
  const [referralDate, setReferralDate] = useState(new Date().toISOString().split('T')[0])
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0])
  const [urgency, setUrgency] = useState('routine')
  const [targetSpecialty, setTargetSpecialty] = useState<SpecialtyType>('mental_health')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null)
  const selectedPatientId = selectedPatient?.id ?? null
  const [registerWizardOpen, setRegisterWizardOpen] = useState(false)
  const [attachments, setAttachments] = useState<File[]>([])
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)

  const flatUnits = React.useMemo(() => tree ? flattenUnits(tree) : [], [tree])

  const internalSources = sources?.filter(s => s.category === 'internal') ?? []
  const externalSources = sources?.filter(s => s.category === 'external') ?? []
  const isInternalSource = internalSources.some(s => s.name === sourceType)
  const derivedFromService = (sourceDetail || sourceType || '').trim()

  const resetForm = () => {
    setSourceType(''); setSourceDetail(''); setReferralDate(new Date().toISOString().split('T')[0])
    setReceivedDate(new Date().toISOString().split('T')[0])
    setUrgency('routine'); setTargetSpecialty('mental_health')
    setReason(''); setNotes('')
    setSubmitError(null)
    setSelectedPatient(null); setAttachments([])
  }

  const handleSubmit = async () => {
    setSubmitError(null)
    if (!selectedPatientId) {
      setSubmitError('Please select an existing patient or register a new one.')
      return
    }
    if (!sourceType.trim()) {
      setSubmitError('Please select a referral source.')
      return
    }
    if (isInternalSource && !sourceDetail.trim()) {
      setSubmitError('Please select the referring team/unit for internal referrals.')
      return
    }
    if (!reason.trim()) {
      setSubmitError('Please enter a reason for referral.')
      return
    }
    if (!derivedFromService) {
      setSubmitError('Referral source details are required.')
      return
    }

    try {
      const referral = await create({
        direction: 'intake',
        referralDate,
        receivedDate,
        source: sourceType,
        fromService: derivedFromService,
        reason: reason.trim(),
        urgency,
        notes: notes.trim() || undefined,
        patientId: selectedPatientId,
        targetSpecialty,
      })

      // Upload attachments if any
      if (attachments.length > 0 && referral?.id) {
        const formData = new FormData()
        attachments.forEach(f => formData.append('file', f))
        try {
          await apiClient.instance.post(`referrals/${referral.id}/attachments`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        } catch {
          // Referral created but attachment upload failed — non-blocking
        }
      }

      resetForm()
      onClose()
    } catch (err) {
      setSubmitError(readApiError(err))
    }
  }

  const handleClose = () => { resetForm(); onClose() }

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAttachments(prev => [...prev, ...Array.from(e.target.files!)])
    }
    e.target.value = ''
  }

  const removeAttachment = (idx: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <>
      <Dialog aria-labelledby="dialog-title" open={open && !registerWizardOpen} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>New Intake Referral</DialogTitle>
        <Divider />
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            Record an inbound referral received manually (for example fax, phone, or scanned letter). This does not create an outbound referral.
          </Typography>
          {submitError ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {submitError}
            </Alert>
          ) : null}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            {/* Patient search — Shape C: shared MUI Autocomplete (BUG-447 child 10/15) */}
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Patient *</Typography>
              <PatientSearchAutocomplete
                value={selectedPatient}
                onChange={setSelectedPatient}
                placeholder="Search existing patient by name or UR…"
                fullWidth
              />
              {!selectedPatient && (
                <Box sx={{ mt: 0.5 }}>
                  <Button size="small" startIcon={<PersonAddIcon />} onClick={() => setRegisterWizardOpen(true)}
                    sx={{ fontSize: 12, color: '#b8621a' }}>
                    Or register a new patient
                  </Button>
                </Box>
              )}
            </Grid>

            {/* Referral source */}
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Referral Source *</InputLabel>
                <Select value={sourceType} onChange={e => setSourceType(e.target.value)} label="Referral Source *">
                  {internalSources.length > 0 && <MenuItem disabled sx={{ fontWeight: 600, fontSize: 12, color: 'text.secondary' }}>— Within Organisation —</MenuItem>}
                  {internalSources.map(s => <MenuItem key={s.id} value={s.name}>{s.name}</MenuItem>)}
                  {externalSources.length > 0 && <MenuItem disabled sx={{ fontWeight: 600, fontSize: 12, color: 'text.secondary' }}>— External —</MenuItem>}
                  {externalSources.map(s => <MenuItem key={s.id} value={s.name}>{s.name}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            {/* If internal source, show team selector */}
            {isInternalSource && (
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Referring Team / Unit *</InputLabel>
                  <Select value={sourceDetail} onChange={e => setSourceDetail(e.target.value)} label="Referring Team / Unit *">
                    {flatUnits.map(u => <MenuItem key={u.id} value={u.name}>{u.name}</MenuItem>)}
                  </Select>
                </FormControl>
              </Grid>
            )}

            <Grid size={{ xs: 12, sm: 3 }}>
              <TextField label="Referral Date" type="date" fullWidth size="small" value={referralDate} onChange={e => setReferralDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <TextField
                label="Received Date"
                type="date"
                fullWidth
                size="small"
                value={receivedDate}
                onChange={e => setReceivedDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Urgency</InputLabel>
                <Select value={urgency} onChange={e => setUrgency(e.target.value)} label="Urgency">
                  {URGENCY_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>

            {/* Multi-specialty: target specialty. Server falls back to
                mental_health when omitted, so existing flows keep working. */}
            <Grid size={{ xs: 12, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Target Specialty</InputLabel>
                <Select value={targetSpecialty} onChange={e => setTargetSpecialty(e.target.value as SpecialtyType)} label="Target Specialty">
                  {ALL_SPECIALTIES.map(code => (
                    <MenuItem key={code} value={code}>{SPECIALTY_DISPLAY[code]}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <TextField label="Reason for Referral *" fullWidth size="small" multiline rows={3} value={reason} onChange={e => setReason(e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField label="Intake Notes" fullWidth size="small" multiline rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Document intake assessment notes" />
            </Grid>

            {/* Attachment upload */}
            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>Attachments</Typography>
              <Box
                role="button"
                tabIndex={0}
                aria-label="Click or press Enter/Space to upload referral letter or documents (PDF, images)"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
                sx={{
                  p: 2, border: '2px dashed', borderColor: 'divider', borderRadius: 2, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.paper',
                  '&:hover': { borderColor: '#b8621a', bgcolor: '#FFF8F2' },
                  '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 },
                  transition: 'all 0.15s',
                }}
              >
                <CloudUploadIcon sx={{ color: '#b8621a', fontSize: 24 }} />
                <Typography variant="body2" color="text.secondary">
                  Click or press Enter/Space to upload referral letter or documents (PDF, images)
                </Typography>
                <input ref={fileInputRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.tiff"
                  style={{ display: 'none' }} onChange={handleFilesSelected} />
              </Box>
              {attachments.length > 0 && (
                <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  {attachments.map((f, i) => (
                    <Box key={`${f.name}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderRadius: 1, bgcolor: 'action.hover' }}>
                      <AttachFileIcon sx={{ fontSize: 16, color: '#b8621a' }} />
                      <Typography variant="body2" sx={{ flexGrow: 1 }}>{f.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{(f.size / 1024).toFixed(0)} KB</Typography>
                      <IconButton size="small" onClick={() => removeAttachment(i)} color="error"><DeleteIcon fontSize="small" /></IconButton>
                    </Box>
                  ))}
                </Box>
              )}
            </Grid>
          </Grid>
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={handleClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={isPending || !reason.trim() || !selectedPatientId || !sourceType.trim() || (isInternalSource && !sourceDetail.trim())}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : 'Create Referral'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Patient Registration Wizard — opens directly from referral dialog */}
      <PatientRegistrationWizard
        open={registerWizardOpen}
        onClose={() => setRegisterWizardOpen(false)}
      />
    </>
  )
}

import React, { useState } from 'react'
import {
  Box, Button, Card, CardContent, Chip, CircularProgress,
  Divider, Tab, Tabs, Typography
} from '@mui/material'
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid'
import QrCode2Icon from '@mui/icons-material/QrCode2'
import TimelineIcon from '@mui/icons-material/Timeline'
import MedicationIcon from '@mui/icons-material/Medication'
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart'
import FlagIcon from '@mui/icons-material/Flag'
import ScheduleIcon from '@mui/icons-material/Schedule'
import PersonIcon from '@mui/icons-material/Person'
import BookIcon from '@mui/icons-material/Book'
import UploadFileIcon from '@mui/icons-material/UploadFile'
import AssessmentIcon from '@mui/icons-material/Assessment'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '../../../../../shared/services/apiClient'
import {
  vivaKeys,
  patientsKeys,
  patientMedicationsKeys,
} from '../../../queryKeys'
import {
  isRecord,
  readArrayField,
  parseJsonFromNote,
  type VivaActivityPayload,
  type VivaDiaryPayload,
  type VivaGoalPayload,
  type VivaInviteResponse,
  type VivaTrackingEntry,
  type VivaTrackingResponse,
} from './vivaTabDomain'
type SubTab = 'mood' | 'vitals' | 'assessments' | 'medications' | 'tasks' | 'diary' | 'goals' | 'activities' | 'docs' | 'profile' | 'invite'
type ThresholdRuleRow = { id?: string; trackingType?: string | null; direction?: string | null; threshold?: number | string | null; consecutiveDays?: number | string | null }
type ThresholdAlertRow = { triggered?: boolean; type?: string | null; direction?: string | null; threshold?: number | string | null; consecutiveDays?: number | string | null; actual?: Array<number | string> }
type MedicationRow = { id?: string; status?: string | null; drugLabel?: string | null; genericName?: string | null; medicationName?: string | null; dose?: string | null; frequency?: string | null; route?: string | null }
type ReminderRow = { id?: string; drugName?: string | null; dose?: string | null; instructions?: string | null; reminderTime?: string | null; daysOfWeek?: number[] }
type SharedDocRow = { id?: string; title?: string | null; url?: string | null; docType?: 'document' | 'weblink' | string | null; createdAt?: string | null }
type SelfRatingTemplateRow = { id?: string; name?: string | null }
type SelfRatingAssessmentRow = { id?: string; status?: string | null; templateName?: string | null; measureType?: string | null; createdAt?: string | null; completedAt?: string | null; totalScore?: number | string | null }
type GoalStatusChange = { action?: string | null; date?: string | null; clinician?: string | null }
type GoalEntryPayload = VivaGoalPayload & { refused?: boolean; source?: string | null; createdAt?: string | null; statusChanges?: GoalStatusChange[] }
type PatientTaskRow = { id?: string; title?: string | null; status?: string | null; dueDate?: string | null }
type PatientChecklistRow = { id?: string; item?: string | null; isCompleted?: boolean }
export const VivaTab: React.FC<{ patientId: string }> = ({ patientId }) => {
  const [subTab, setSubTab] = useState<SubTab>('mood')

  return (
    <Box p={2}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <PhoneAndroidIcon sx={{ mr: 1, color: '#7B1FA2' }} />
        <Typography variant="h6" fontWeight={700}>Viva by Signacare</Typography>
      </Box>
      <Tabs value={subTab} onChange={(_, v) => setSubTab(v)} sx={{ mb: 2 }} variant="scrollable" scrollButtons="auto">
        <Tab value="mood" label="Wellbeing" icon={<TimelineIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="vitals" label="Vitals" icon={<MonitorHeartIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="assessments" label="Assessments" icon={<AssessmentIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="medications" label="Medications" icon={<MedicationIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="tasks" label="Tasks & Checklists" icon={<FlagIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="diary" label="Diary" icon={<BookIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="goals" label="Recovery Goals" icon={<FlagIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="activities" label="Activities" icon={<ScheduleIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="docs" label="Documents" icon={<UploadFileIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="profile" label="Profile & Consent" icon={<PersonIcon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
        <Tab value="invite" label="Invite & Setup" icon={<QrCode2Icon sx={{ fontSize: 16 }} />} iconPosition="start" sx={{ minHeight: 40, fontSize: 12 }} />
      </Tabs>
      <Divider sx={{ mb: 2 }} />
      {subTab === 'mood' && <WellbeingPanel patientId={patientId} />}
      {subTab === 'vitals' && <VitalsPanel patientId={patientId} />}
      {subTab === 'assessments' && <AssessmentsPanel patientId={patientId} />}
      {subTab === 'medications' && <CombinedMedicationsPanel patientId={patientId} />}
      {subTab === 'tasks' && <PatientTasksPanel patientId={patientId} />}
      {subTab === 'diary' && <DiaryPanel patientId={patientId} />}
      {subTab === 'goals' && <GoalsPanel patientId={patientId} />}
      {subTab === 'activities' && <ActivitiesPanel patientId={patientId} />}
      {subTab === 'docs' && <SharedDocsPanel patientId={patientId} />}
      {subTab === 'profile' && <ProfileComparisonPanel patientId={patientId} />}
      {subTab === 'invite' && <InvitePanel patientId={patientId} />}
    </Box>
  )
}

function InvitePanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const { data: inviteData, isLoading } = useQuery({
    queryKey: vivaKeys.invite(patientId),
    queryFn: () => apiClient.get<VivaInviteResponse>(`patient-app/invite/${patientId}`),
  })
  const generateMut = useMutation({
    mutationFn: () => apiClient.post<VivaInviteResponse>(`patient-app/invite/${patientId}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: vivaKeys.invite(patientId) }),
  })

  if (isLoading) return <CircularProgress size={24} />
  const hasAccount = inviteData?.hasAccount
  const activeInvite = inviteData?.invite
  const lastLogin = inviteData?.lastLogin ?? null

  return (
    <Box>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>Viva App Status</Typography>
          {hasAccount ? (
            <Box>
              <Chip label={inviteData?.accountActive ? 'Active' : 'Inactive'} color={inviteData?.accountActive ? 'success' : 'default'} size="small" sx={{ mb: 1 }} />
              {lastLogin && <Typography variant="body2" color="text.secondary">Last login: {new Date(lastLogin).toLocaleString('en-AU')}</Typography>}
            </Box>
          ) : (
            <Chip label="Not Set Up" color="warning" size="small" sx={{ mb: 1 }} />
          )}
        </CardContent>
      </Card>
      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>Invite to Viva</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Generate a 6-digit code. Patient enters it in Viva app to activate. Expires in 48h.</Typography>
          <Button variant="contained" startIcon={<QrCode2Icon />} onClick={() => generateMut.mutate()} disabled={generateMut.isPending}
            sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>
            {generateMut.isPending ? 'Generating...' : 'Generate Invite Code'}
          </Button>
          {activeInvite && (
            <Box sx={{ mt: 2, p: 2, bgcolor: '#F3E5F5', borderRadius: 2, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Current Invite Code</Typography>
              <Typography variant="h3" fontWeight={800} sx={{ color: '#7B1FA2', letterSpacing: 8, my: 1 }}>{activeInvite.code}</Typography>
              <Typography variant="caption" color="text.secondary">Expires: {activeInvite.expiresAt ? new Date(activeInvite.expiresAt).toLocaleString('en-AU') : 'Not set'}</Typography>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  )
}

const TYPE_CONFIG: Record<string, { label: string; color: string; unit?: string }> = {
  mood: { label: 'Mood', color: '#2196F3' },
  anxiety: { label: 'Anxiety', color: '#E91E63' },
  sleep: { label: 'Sleep', color: '#673AB7' },
  energy: { label: 'Energy', color: '#FF9800' },
  weight: { label: 'Weight', color: '#F57C00', unit: 'kg' },
  height: { label: 'Height', color: '#5C6BC0', unit: 'cm' },
  bpSystolic: { label: 'BP Systolic', color: '#D32F2F', unit: 'mmHg' },
  bpDiastolic: { label: 'BP Diastolic', color: '#E57373', unit: 'mmHg' },
  bloodSugar: { label: 'Blood Sugar', color: '#0288D1', unit: 'mmol/L' },
  meds: { label: 'Medication', color: '#00897B' },
}

function TrackingPanel({ patientId, types, title }: { patientId: string; types: string[]; title: string }) {
  const { data, isLoading } = useQuery({
    queryKey: vivaKeys.trackingByType(patientId, types.join(',')),
    queryFn: async () => {
      const params: Record<string, string> = { days: '30' }
      if (types.length === 1) params.type = types[0]
      const result = await apiClient.get<VivaTrackingResponse>(`patient-app/tracking/${patientId}`, params)
      return result.entries ?? []
    },
  })

  if (isLoading) return <CircularProgress size={24} />
  const entries: VivaTrackingEntry[] = data ?? []
  const filtered = types.length > 0 ? entries.filter(e => types.includes(e.type ?? '')) : entries

  if (filtered.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography color="text.secondary">No data synced from Viva app yet.</Typography>
        <Typography variant="caption" color="text.secondary">Patient needs to enable sync in their Viva app settings.</Typography>
      </Box>
    )
  }

  // Group by type
  const grouped: Record<string, VivaTrackingEntry[]> = {}
  for (const e of filtered) {
    const t = e.type ?? 'unknown'
    if (!grouped[t]) grouped[t] = []
    grouped[t].push(e)
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>{title}</Typography>
      {Object.entries(grouped).map(([type, entries]) => {
        const cfg = TYPE_CONFIG[type] ?? { label: type, color: '#999' }
        const sorted = [...entries].sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? ''))
        const latest = sorted[sorted.length - 1]
        const avg = sorted.length > 0 ? (sorted.reduce((s: number, e) => s + Number(e.value ?? 0), 0) / sorted.length).toFixed(1) : '—'

        return (
          <Card key={type} variant="outlined" sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: cfg.color, mr: 1 }} />
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label}</Typography>
                <Chip label={`${sorted.length} entries`} size="small" sx={{ ml: 1, fontSize: 10 }} />
                <Box sx={{ flex: 1 }} />
                {latest && <Typography variant="h6" fontWeight={700} sx={{ color: cfg.color }}>
                  {type === 'meds' ? (Number(latest.value) >= 1 ? 'Taken' : 'Missed') : Number(latest.value).toFixed(1)}
                  {cfg.unit ? ` ${cfg.unit}` : ''}
                </Typography>}
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>avg: {avg}</Typography>
              </Box>

              {/* Simple SVG sparkline chart */}
              {sorted.length >= 2 && (
                <Box sx={{ height: 80, mt: 1, mb: 1 }}>
                  <svg width="100%" height="80" viewBox={`0 0 ${sorted.length - 1} 100`} preserveAspectRatio="none">
                    {/* Normal range band for tracking types */}
                    {['mood', 'anxiety', 'sleep', 'energy'].includes(type) && (
                      <rect x="0" y="30" width={sorted.length - 1} height="40" fill={cfg.color} opacity="0.06" />
                    )}
                    {/* Line */}
                    <polyline
                      points={sorted.map((e, i: number) => {
                        const vals = sorted.map(s => Number(s.value ?? 0))
                        const min = Math.min(...vals) * 0.9
                        const max = Math.max(...vals) * 1.1 || 1
                        const y = 95 - ((Number(e.value ?? 0) - min) / (max - min)) * 90
                        return `${i},${y}`
                      }).join(' ')}
                      fill="none" stroke={cfg.color} strokeWidth="2" vectorEffect="non-scaling-stroke"
                    />
                    {/* Area fill */}
                    <polygon
                      points={`0,100 ${sorted.map((e, i: number) => {
                        const vals = sorted.map(s => Number(s.value ?? 0))
                        const min = Math.min(...vals) * 0.9
                        const max = Math.max(...vals) * 1.1 || 1
                        const y = 95 - ((Number(e.value ?? 0) - min) / (max - min)) * 90
                        return `${i},${y}`
                      }).join(' ')} ${sorted.length - 1},100`}
                      fill={cfg.color} opacity="0.08"
                    />
                  </svg>
                </Box>
              )}

              {/* Recent entries table */}
              <Box sx={{ maxHeight: 200, overflowY: 'auto' }}>
                {sorted.slice(-20).reverse().map((e, i: number) => (
                  <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid #f0f0f0', fontSize: 12 }}>
                    <Typography variant="body2" sx={{ fontSize: 11, minWidth: 100 }}>
                      {e.recordedAt ? new Date(e.recordedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                    </Typography>
                    <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12, color: cfg.color }}>
                      {type === 'meds' ? (Number(e.value) >= 1 ? 'Taken' : 'Missed') : Number(e.value).toFixed(1)}
                      {cfg.unit ? ` ${cfg.unit}` : ''}
                    </Typography>
                    {e.note && <Typography variant="body2" sx={{ fontSize: 10, color: '#888', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.note}</Typography>}
                    <Chip label={e.source === 'patient_app' ? 'Patient' : 'Clinician'} size="small"
                      sx={{ fontSize: 9, height: 18, bgcolor: e.source === 'patient_app' ? '#F3E5F5' : '#E3F2FD' }} />
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        )
      })}
    </Box>
  )
}

export function JsonEntriesPanel({ patientId, type, title }: { patientId: string; type: string; title: string }) {
  const { data, isLoading } = useQuery({
    queryKey: vivaKeys.trackingByType(patientId, type),
    queryFn: async () => {
      const result = await apiClient.get<VivaTrackingResponse>(`patient-app/tracking/${patientId}`, { type, days: '90' })
      return result.entries ?? []
    },
  })

  if (isLoading) return <CircularProgress size={24} />
  const entries = data ?? []

  if (entries.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography color="text.secondary">No {title.toLowerCase()} synced from Viva app yet.</Typography>
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>{title}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>{entries.length} entries synced</Typography>
      {entries.slice(0, 30).map((e: VivaTrackingEntry, i: number) => {
        const parsed = parseJsonFromNote(e.note)

        if (type === 'diary' && isRecord(parsed)) {
          const diary = parsed as VivaDiaryPayload
          return (
            <Card key={i} variant="outlined" sx={{ mb: 1 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                  <Typography variant="body2" fontWeight={600}>{diary.mood ? `${diary.mood} ` : ''}{diary.title || 'Entry'}</Typography>
                  <Typography variant="caption" color="text.secondary">{e.recordedAt ? new Date(e.recordedAt).toLocaleDateString('en-AU') : ''}</Typography>
                </Box>
                {diary.content && <Typography variant="body2" sx={{ fontSize: 12, color: '#555', mt: 0.5, whiteSpace: 'pre-wrap' }}>{diary.content}</Typography>}
              </CardContent>
            </Card>
          )
        }

        if (type === 'goal' && isRecord(parsed)) {
          const goal = parsed as VivaGoalPayload
          const progress = goal.progress ?? 0
          return (
            <Card key={i} variant="outlined" sx={{ mb: 1 }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>{goal.title || 'Goal'}</Typography>
                  <Chip label={goal.category || ''} size="small" sx={{ fontSize: 9, mr: 1 }} />
                  <Typography variant="body2" fontWeight={700} sx={{ color: progress >= 100 ? '#2E7D32' : progress > 50 ? '#F57C00' : '#7B1FA2' }}>{progress}%</Typography>
                </Box>
                <Box sx={{ mt: 0.5, height: 4, bgcolor: '#eee', borderRadius: 2 }}>
                  <Box sx={{ height: 4, width: `${progress}%`, bgcolor: progress >= 100 ? '#2E7D32' : '#7B1FA2', borderRadius: 2 }} />
                </Box>
                {(goal.steps ?? []).map((s, si: number) => (
                  <Typography key={si} variant="body2" sx={{ fontSize: 11, color: s.done ? '#999' : '#333', textDecoration: s.done ? 'line-through' : 'none', ml: 1, mt: 0.3 }}>
                    {s.done ? '✓' : '○'} {s.text}
                  </Typography>
                ))}
              </CardContent>
            </Card>
          )
        }

        if (type === 'activity' && isRecord(parsed)) {
          const activity = parsed as VivaActivityPayload
          return (
            <Card key={i} variant="outlined" sx={{ mb: 0.5 }}>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 }, display: 'flex', alignItems: 'center' }}>
                <Typography sx={{ fontSize: 14, mr: 1 }}>{activity.done ? '✅' : '⬜'}</Typography>
                {activity.time && <Typography variant="body2" fontWeight={600} sx={{ mr: 1, fontSize: 12 }}>{activity.time}</Typography>}
                <Typography variant="body2" sx={{ flex: 1, fontSize: 12, color: activity.done ? '#999' : '#333', textDecoration: activity.done ? 'line-through' : 'none' }}>{activity.name || 'Activity'}</Typography>
                {activity.category && <Chip label={activity.category} size="small" sx={{ fontSize: 9 }} />}
              </CardContent>
            </Card>
          )
        }

        if (type === 'profile' && parsed && typeof parsed === 'object') {
          return (
            <Card key={i} variant="outlined" sx={{ mb: 1 }}>
              <CardContent>
                <Typography variant="subtitle2" color="text.secondary" gutterBottom>Patient-Reported Profile</Typography>
                {Object.entries(parsed).filter(([_, v]) => v && String(v).length > 0).map(([k, v]) => (
                  <Box key={k} sx={{ display: 'flex', py: 0.3 }}>
                    <Typography variant="body2" sx={{ width: 160, fontSize: 11, color: '#888' }}>{k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</Typography>
                    <Typography variant="body2" sx={{ fontSize: 12 }}>{String(v)}</Typography>
                  </Box>
                ))}
              </CardContent>
            </Card>
          )
        }

        // Fallback
        return (
          <Card key={i} variant="outlined" sx={{ mb: 0.5 }}>
            <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
              <Typography variant="body2" sx={{ fontSize: 11 }}>{typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}</Typography>
            </CardContent>
          </Card>
        )
      })}
    </Box>
  )
}

function WellbeingPanel({ patientId }: { patientId: string }) {
  return <ThresholdTrackingPanel patientId={patientId}
    types={['mood', 'anxiety', 'sleep', 'energy']} title="Wellbeing"
    thresholdDefaults={{
      mood: { direction: 'below', threshold: 3, days: 3, label: 'Mood drops below' },
      anxiety: { direction: 'above', threshold: 7, days: 3, label: 'Anxiety rises above' },
      sleep: { direction: 'below', threshold: 3, days: 3, label: 'Sleep drops below' },
      energy: { direction: 'below', threshold: 3, days: 3, label: 'Energy drops below' },
    }} />
}

function VitalsPanel({ patientId }: { patientId: string }) {
  return <ThresholdTrackingPanel patientId={patientId}
    types={['weight', 'bpSystolic', 'bpDiastolic', 'bloodSugar', 'height']} title="Vitals"
    thresholdDefaults={{
      weight: { direction: 'above', threshold: 100, days: 1, label: 'Weight above' },
      bpSystolic: { direction: 'above', threshold: 140, days: 2, label: 'Systolic BP above' },
      bpDiastolic: { direction: 'above', threshold: 90, days: 2, label: 'Diastolic BP above' },
      bloodSugar: { direction: 'above', threshold: 11, days: 2, label: 'Blood sugar above' },
    }} />
}

function ThresholdTrackingPanel({ patientId, types, title, thresholdDefaults }: {
  patientId: string; types: string[]; title: string;
  thresholdDefaults: Record<string, { direction: string; threshold: number; days: number; label: string }>;
}) {
  const qc = useQueryClient()
  const [showThresholdForm, setShowThresholdForm] = React.useState(false)
  const [newType, setNewType] = React.useState(types[0])
  const [newDirection, setNewDirection] = React.useState('below')
  const [newThreshold, setNewThreshold] = React.useState('')
  const [newDays, setNewDays] = React.useState('3')

  // Fetch tracking data
  const { data: trackingData, isLoading } = useQuery({
    queryKey: vivaKeys.trackingByType(patientId, types.join(',')),
    queryFn: async () => {
      const params: Record<string, string> = { days: '30' }
      const result = await apiClient.get<VivaTrackingResponse>(`patient-app/tracking/${patientId}`, params)
      const entries = result.entries ?? []
      return entries.filter((e) => types.includes(e.type ?? ''))
    },
  })

  // Fetch thresholds
  const { data: thresholds } = useQuery({
    queryKey: vivaKeys.thresholds(patientId),
    queryFn: () => apiClient.get<unknown>(`patient-app/thresholds/${patientId}`).then(r => readArrayField<ThresholdRuleRow>(r, 'thresholds')),
  })

  // Fetch triggered alerts
  const { data: alertCheck } = useQuery({
    queryKey: vivaKeys.thresholdCheck(patientId),
    queryFn: () => apiClient.get<unknown>(`patient-app/threshold-check/${patientId}`).then(r => readArrayField<ThresholdAlertRow>(r, 'alerts')),
    staleTime: 60_000,
  })

  const addThreshold = useMutation({
    mutationFn: (data: { trackingType: string; direction: string; threshold: number; consecutiveDays: number }) => apiClient.post(`patient-app/thresholds/${patientId}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vivaKeys.thresholds(patientId) }); qc.invalidateQueries({ queryKey: vivaKeys.thresholdCheck(patientId) }); setShowThresholdForm(false); setNewThreshold(''); },
  })

  const removeThreshold = useMutation({
    mutationFn: (id: string) => apiClient.delete(`patient-app/thresholds/${patientId}/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vivaKeys.thresholds(patientId) }); qc.invalidateQueries({ queryKey: vivaKeys.thresholdCheck(patientId) }); },
  })

  if (isLoading) return <CircularProgress size={24} />

  // Group data by type
  const grouped: Record<string, VivaTrackingEntry[]> = {}
  for (const e of (trackingData ?? [])) {
    const trackingType = e.type ?? ''
    if (!grouped[trackingType]) grouped[trackingType] = []
    grouped[trackingType].push(e)
  }

  const triggeredAlerts = (alertCheck ?? []).filter((a) => a.triggered && types.includes(a.type ?? ''))
  const activeThresholds = (thresholds ?? []).filter((t) => types.includes(t.trackingType ?? ''))

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>{title}</Typography>

      {/* Triggered alerts banner */}
      {triggeredAlerts.length > 0 && triggeredAlerts.map((a, i: number) => (
        (() => {
          const alertType = a.type ?? ''
          return (
            <Box key={i} sx={{ p: 1.5, mb: 1, bgcolor: '#FFF3E0', borderRadius: 2, border: '1px solid #FFB74D', display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 18, marginRight: 8 }}>⚠️</span>
              <Box>
                <Typography variant="body2" fontWeight={700} sx={{ color: '#E65100', fontSize: 12 }}>
                  Alert: {(TYPE_CONFIG[alertType]?.label ?? alertType)} {a.direction === 'below' ? '≤' : '≥'} {a.threshold} for {a.consecutiveDays}+ days
                </Typography>
                <Typography variant="caption" color="text.secondary">Recent values: {(a.actual ?? []).join(', ')}</Typography>
              </Box>
            </Box>
          )
        })()
      ))}

      {/* Charts for each type */}
      {types.map(type => {
        const entries = (grouped[type] ?? []).sort((a, b) => (a.recordedAt ?? '').localeCompare(b.recordedAt ?? ''))
        const cfg = TYPE_CONFIG[type] ?? { label: type, color: '#999' }
        const latest = entries[entries.length - 1]
        const avg = entries.length > 0 ? (entries.reduce((s: number, e) => s + Number(e.value ?? 0), 0) / entries.length).toFixed(1) : '—'

        if (entries.length === 0 && type === 'height') return null // skip height if no data

        return (
          <Card key={type} variant="outlined" sx={{ mb: 2 }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: cfg.color, mr: 1 }} />
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label}</Typography>
                <Chip label={`${entries.length} entries`} size="small" sx={{ ml: 1, fontSize: 10 }} />
                <Box sx={{ flex: 1 }} />
                {latest && <Typography variant="h6" fontWeight={700} sx={{ color: cfg.color }}>
                  {type === 'meds' ? (Number(latest.value) >= 1 ? 'Taken' : 'Missed') : Number(latest.value).toFixed(type.includes('bp') || type === 'weight' ? 0 : 1)}
                  {cfg.unit ? ` ${cfg.unit}` : ''}
                </Typography>}
                <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>avg: {avg}</Typography>
              </Box>

              {/* SVG Chart with normal range band */}
              {entries.length >= 2 && (() => {
                const vals = entries.map((e) => Number(e.value ?? 0))
                const dataMin = Math.min(...vals)
                const dataMax = Math.max(...vals)
                // Fixed ranges for known types
                const ranges: Record<string, [number, number]> = {
                  mood: [1, 10], anxiety: [1, 10], sleep: [1, 10], energy: [1, 10],
                  weight: [40, 120], bpSystolic: [80, 180], bpDiastolic: [50, 110],
                  bloodSugar: [2, 15], height: [140, 200],
                }
                const normalRanges: Record<string, [number, number]> = {
                  mood: [5, 10], anxiety: [1, 4], sleep: [5, 10], energy: [5, 10],
                  weight: [50, 100], bpSystolic: [90, 120], bpDiastolic: [60, 80],
                  bloodSugar: [4, 7.8],
                }
                const range = ranges[type] ?? [dataMin * 0.8, dataMax * 1.2]
                const chartMin = Math.min(range[0], dataMin * 0.9)
                const chartMax = Math.max(range[1], dataMax * 1.1)
                const span = chartMax - chartMin || 1
                const toY = (v: number) => 95 - ((v - chartMin) / span) * 90
                const normalRange = normalRanges[type]

                return (
                  <Box sx={{ height: 120, my: 1 }}>
                    <svg width="100%" height="120" viewBox={`0 0 ${Math.max(entries.length - 1, 1)} 120`} preserveAspectRatio="none">
                      {/* Normal range band (green) */}
                      {normalRange && (
                        <rect x="0" y={toY(normalRange[1])} width={entries.length - 1}
                          height={Math.abs(toY(normalRange[0]) - toY(normalRange[1]))}
                          fill="#4CAF50" opacity="0.1" />
                      )}
                      {/* Threshold lines */}
                      {activeThresholds.filter((t) => t.trackingType === type).map((t, ti: number) => (
                        <line key={ti} x1="0" y1={toY(Number(t.threshold))} x2={entries.length - 1} y2={toY(Number(t.threshold))}
                          stroke="#E65100" strokeWidth="1" strokeDasharray="4,3" vectorEffect="non-scaling-stroke" />
                      ))}
                      {/* Data line */}
                      <polyline points={entries.map((e, i: number) => `${i},${toY(Number(e.value ?? 0))}`).join(' ')}
                        fill="none" stroke={cfg.color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                      {/* Fill under line */}
                      <polygon points={`0,115 ${entries.map((e, i: number) => `${i},${toY(Number(e.value ?? 0))}`).join(' ')} ${entries.length - 1},115`}
                        fill={cfg.color} opacity="0.06" />
                      {/* Data points */}
                      {entries.length <= 20 && entries.map((e, i: number) => (
                        <circle key={i} cx={i} cy={toY(Number(e.value ?? 0))} r="3" fill={cfg.color} vectorEffect="non-scaling-stroke" />
                      ))}
                    </svg>
                    {/* Legend */}
                    <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', mt: 0.5 }}>
                      {normalRange && <Box sx={{ display: 'flex', alignItems: 'center' }}>
                        <Box sx={{ width: 12, height: 8, bgcolor: '#4CAF50', opacity: 0.3, mr: 0.5, borderRadius: 0.5 }} />
                        <Typography sx={{ fontSize: 9, color: '#888' }}>Normal ({normalRange[0]}–{normalRange[1]})</Typography>
                      </Box>}
                      {activeThresholds.filter((t) => t.trackingType === type).length > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Box sx={{ width: 12, height: 0, borderTop: '2px dashed #E65100', mr: 0.5 }} />
                          <Typography sx={{ fontSize: 9, color: '#888' }}>Alert threshold</Typography>
                        </Box>
                      )}
                    </Box>
                  </Box>
                )
              })()}

              {entries.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>No data from Viva app yet</Typography>}

              {/* Recent entries with edit/delete */}
              {entries.length > 0 && (
                <Box sx={{ maxHeight: 160, overflowY: 'auto', mt: 0.5 }}>
                  {entries.slice(-15).reverse().map((e, i: number) => (
                    <_EditableEntry key={e.id ?? `${type}-${i}`} entry={e} type={type} color={cfg.color} unit={cfg.unit}
                      onUpdated={() => qc.invalidateQueries({ queryKey: vivaKeys.trackingByType(patientId, types.join(',')) })} />
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Threshold settings */}
      <Divider sx={{ my: 2 }} />
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700}>Alert Thresholds</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="outlined" onClick={() => setShowThresholdForm(!showThresholdForm)} sx={{ fontSize: 11 }}>
          {showThresholdForm ? 'Cancel' : '+ Add Threshold'}
        </Button>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
        Get alerted when patient scores cross a threshold for consecutive days
      </Typography>

      {/* Active thresholds */}
      {activeThresholds.map((t, i: number) => {
        const trackingType = t.trackingType ?? ''
        const triggered = triggeredAlerts.some((a) => a.type === t.trackingType)
        return (
          <Box key={t.id ?? `threshold-${i}`} sx={{ display: 'flex', alignItems: 'center', py: 0.5, px: 1, mb: 0.5,
            bgcolor: triggered ? '#FFF3E0' : '#f8f8f8', borderRadius: 1, border: triggered ? '1px solid #FFB74D' : '1px solid #eee' }}>
            {triggered && <span style={{ marginRight: 4 }}>⚠️</span>}
            <Typography sx={{ fontSize: 12, flex: 1 }}>
              <strong>{TYPE_CONFIG[trackingType]?.label ?? trackingType}</strong> {t.direction === 'below' ? '≤' : '≥'} {Number(t.threshold)} for {t.consecutiveDays}+ days
            </Typography>
            <Button size="small" color="error" sx={{ fontSize: 10, minWidth: 0 }} onClick={() => t.id && removeThreshold.mutate(t.id)}>Remove</Button>
          </Box>
        )
      })}

      {/* Add threshold form */}
      {showThresholdForm && (
        <Card variant="outlined" sx={{ mt: 1, p: 1.5 }}>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={newType} onChange={e => {
              setNewType(e.target.value)
              const def = thresholdDefaults[e.target.value]
              if (def) { setNewDirection(def.direction); setNewThreshold(String(def.threshold)); setNewDays(String(def.days)); }
            }} style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }}>
              {types.filter(t => t !== 'height').map(t => <option key={t} value={t}>{TYPE_CONFIG[t]?.label ?? t}</option>)}
            </select>
            <select value={newDirection} onChange={e => setNewDirection(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }}>
              <option value="below">drops below</option>
              <option value="above">rises above</option>
            </select>
            <input value={newThreshold} onChange={e => setNewThreshold(e.target.value)} placeholder="Value"
              style={{ width: 60, padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }} />
            <Typography sx={{ fontSize: 12 }}>for</Typography>
            <input value={newDays} onChange={e => setNewDays(e.target.value)} placeholder="Days"
              style={{ width: 40, padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }} />
            <Typography sx={{ fontSize: 12 }}>consecutive days</Typography>
            <Button size="small" variant="contained" disabled={!newThreshold || addThreshold.isPending}
              onClick={() => addThreshold.mutate({ trackingType: newType, direction: newDirection, threshold: Number(newThreshold), consecutiveDays: Number(newDays) })}
              sx={{ fontSize: 11, bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>
              {addThreshold.isPending ? '...' : 'Add'}
            </Button>
          </Box>
        </Card>
      )}
    </Box>
  )
}

function _EditableEntry({ entry, type, color, unit, onUpdated }: {
  entry: VivaTrackingEntry; type: string; color: string; unit?: string; onUpdated: () => void;
}) {
  const [editing, setEditing] = React.useState(false)
  const [editVal, setEditVal] = React.useState(String(entry.value))
  const [saving, setSaving] = React.useState(false)

  const handleSave = async () => {
    if (!entry.id) return
    setSaving(true)
    try {
      await apiClient.patch(`patient-app/tracking/${entry.id}`, { value: Number(editVal) })
      setEditing(false)
      onUpdated()
    } catch (err) {
      // BUG-520: fail loud here (pre-fix swallowed error and looked like success).
      const msg = err instanceof Error ? err.message : String(err)
      console.error('BUG-520: tracking-entry update failed', { err, entryId: entry.id, value: editVal })
      alert(`Failed to update tracking entry: ${msg}`)
    }
    setSaving(false)
  }

  const handleDelete = async () => {
    if (!entry.id) return
    if (!confirm('Delete this entry?')) return
    try {
      await apiClient.delete(`patient-app/tracking/${entry.id}`)
      onUpdated()
    } catch (err) {
      // BUG-520: fail loud on delete too (pre-fix swallowed error and looked successful).
      const msg = err instanceof Error ? err.message : String(err)
      console.error('BUG-520: tracking-entry delete failed', { err, entryId: entry.id })
      alert(`Failed to delete tracking entry: ${msg}`)
    }
  }

  const displayVal = type === 'meds'
    ? (Number(entry.value) >= 1 ? 'Taken' : 'Missed')
    : `${Number(entry.value).toFixed(type.includes('bp') || type === 'weight' ? 0 : 1)}${unit ? ` ${unit}` : ''}`

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', py: 0.3, borderBottom: '1px solid #f5f5f5', '&:hover .edit-btns': { opacity: 1 } }}>
      <Typography sx={{ fontSize: 10, width: 90, color: '#888' }}>
        {entry.recordedAt ? new Date(entry.recordedAt).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
      </Typography>
      {editing ? (
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <input value={editVal} onChange={e => setEditVal(e.target.value)}
            style={{ width: 50, padding: '2px 4px', border: '1px solid #ddd', borderRadius: 4, fontSize: 11 }} />
          <Button size="small" sx={{ fontSize: 9, minWidth: 0, p: '2px 6px' }} onClick={handleSave} disabled={saving}>
            {saving ? '...' : '✓'}
          </Button>
          <Button size="small" sx={{ fontSize: 9, minWidth: 0, p: '2px 6px', color: '#999' }} onClick={() => setEditing(false)}>✕</Button>
        </Box>
      ) : (
        <Typography sx={{ fontSize: 11, fontWeight: 600, color, width: 60 }}>{displayVal}</Typography>
      )}
      {entry.note && !editing && <Typography sx={{ fontSize: 10, color: '#888', flex: 1 }} noWrap>{entry.note}</Typography>}
      {!editing && <Typography sx={{ fontSize: 9, color: '#aaa', width: 45 }}>{entry.source === 'patient_app' ? 'Patient' : 'Clinician'}</Typography>}
      {!editing && (
        <Box className="edit-btns" sx={{ opacity: 0, transition: 'opacity 0.2s', display: 'flex', gap: 0.3 }}>
          <Button size="small" sx={{ fontSize: 8, minWidth: 0, p: '1px 4px', color: '#888' }} onClick={() => setEditing(true)}>Edit</Button>
          <Button size="small" sx={{ fontSize: 8, minWidth: 0, p: '1px 4px', color: '#D32F2F' }} onClick={handleDelete}>Del</Button>
        </Box>
      )}
    </Box>
  )
}

function CombinedMedicationsPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const [groupTime, setGroupTime] = React.useState('08:00')
  const [groupLabel, setGroupLabel] = React.useState('Morning')
  const [groupDays, setGroupDays] = React.useState([1,2,3,4,5,6,7])
  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const groupPresets = [
    { label: 'Morning', time: '08:00' },
    { label: 'Afternoon', time: '13:00' },
    { label: 'Evening', time: '18:00' },
    { label: 'Night', time: '21:00' },
  ]

  const { data: medsData } = useQuery({
    queryKey: patientMedicationsKeys.byPatient(patientId),
    queryFn: () => apiClient.get<unknown>(`medications/patients/${patientId}/medications`).then(r => {
        const list = readArrayField<MedicationRow>(r, 'data')
        return list.filter((m) => m.status === 'active')
      }),
  })

  const { data: reminders } = useQuery({
    queryKey: vivaKeys.reminders(patientId),
    queryFn: () => apiClient.get<unknown>(`patient-app/med-reminders/${patientId}`).then(r => readArrayField<ReminderRow>(r, 'reminders')),
  })

  const addReminderMut = useMutation({
    mutationFn: (data: { drugName: string; dose: string; instructions: string; reminderTime: string; daysOfWeek: number[]; medicationId?: string }) => apiClient.post(`patient-app/med-reminders/${patientId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: vivaKeys.reminders(patientId) }),
  })

  const removeReminderMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`patient-app/med-reminders/${patientId}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: vivaKeys.reminders(patientId) }),
  })

  const simplify = (m: MedicationRow): string => {
    const name = m.drugLabel ?? m.genericName ?? 'Medication'
    const dose = m.dose ?? ''
    const freq = (m.frequency ?? '').toLowerCase()
    const tab = (m.route ?? 'oral').toLowerCase() === 'oral' ? 'tablet' : 'dose'
    if (freq.includes('nocte') || freq.includes('night')) return `${name} ${dose} — take one ${tab} at night`
    if (freq.includes('mane') || freq.includes('morning')) return `${name} ${dose} — take one ${tab} in the morning`
    if (freq.includes('bd') || freq.includes('twice')) return `${name} ${dose} — take one ${tab} morning and night`
    if (freq.includes('tds') || freq.includes('three')) return `${name} ${dose} — take one ${tab} three times a day`
    if (freq.includes('prn') || freq.includes('needed')) return `${name} ${dose} — take as needed`
    if (freq.includes('weekly')) return `${name} ${dose} — take once a week`
    return `${name} ${dose} — take as directed`
  }

  const getReminder = (medName: string) => (reminders ?? []).find((r) => r.drugName === medName)

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 0.5 }}>Current Medications</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
        Active medications with patient-friendly instructions. Set reminders directly — they sync to the Viva app.
      </Typography>

      {/* Group reminder setup */}
      {medsData && medsData.length > 0 && (
        <Card variant="outlined" sx={{ mb: 2, bgcolor: '#f8f5fa' }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 1 }}>Set Reminder for Multiple Medications</Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
              {groupPresets.map(p => (
                <Chip key={p.label} size="small" label={`${p.label} (${p.time})`}
                  variant={groupLabel === p.label ? 'filled' : 'outlined'}
                  color={groupLabel === p.label ? 'primary' : 'default'}
                  onClick={() => { setGroupLabel(p.label); setGroupTime(p.time); }}
                  sx={{ fontSize: 10, cursor: 'pointer' }} />
              ))}
              <input type="time" value={groupTime} onChange={e => setGroupTime(e.target.value)}
                style={{ padding: '2px 6px', border: '1px solid #ddd', borderRadius: 4, fontSize: 11 }} />
              {dayLabels.map((d, i) => (
                <Chip key={i} size="small" label={d} variant={groupDays.includes(i+1) ? 'filled' : 'outlined'}
                  color={groupDays.includes(i+1) ? 'primary' : 'default'}
                  onClick={() => setGroupDays(prev => prev.includes(i+1) ? prev.filter(x => x !== i+1) : [...prev, i+1])}
                  sx={{ fontSize: 8, height: 18, cursor: 'pointer' }} />
              ))}
              <Button size="small" variant="contained" disabled={addReminderMut.isPending}
                onClick={() => {
                  // Add reminder for ALL meds that don't have one yet
                  const unset = medsData.filter((m) => !getReminder(m.drugLabel ?? m.genericName ?? m.medicationName ?? ''))
                  for (const m of unset) {
                    const name = m.drugLabel ?? m.genericName ?? m.medicationName ?? ''
                    addReminderMut.mutate({ drugName: name, dose: m.dose ?? '', instructions: simplify(m),
                      reminderTime: groupTime, daysOfWeek: groupDays, medicationId: m.id ?? undefined })
                  }
                }}
                sx={{ fontSize: 10, bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>
                Set for All ({medsData.filter((m) => !getReminder(m.drugLabel ?? m.genericName ?? m.medicationName ?? '')).length})
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {(!medsData || medsData.length === 0) ? (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No active medications</Typography>
      ) : medsData.map((m) => {
        const name = m.drugLabel ?? m.genericName ?? m.medicationName ?? ''
        const existing = getReminder(name)
        return (
          <Card key={m.id} variant="outlined" sx={{ mb: 1 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
                <Box sx={{ width: 28, height: 28, borderRadius: 1, bgcolor: '#E8F5E9', display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 1.5, mt: 0.3 }}>
                  <span style={{ fontSize: 14 }}>💊</span>
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={700} sx={{ fontSize: 13 }}>{name}</Typography>
                  <Typography variant="body2" sx={{ fontSize: 11, color: '#555' }}>{simplify(m)}</Typography>
                </Box>
                {existing ? (
                  <Box sx={{ textAlign: 'right' }}>
                    <Chip label={`⏰ ${existing.reminderTime}`} size="small" color="success" sx={{ fontSize: 9 }} />
                    <Button size="small" color="error" sx={{ fontSize: 9, minWidth: 0, p: 0, display: 'block' }}
                      onClick={() => existing.id && removeReminderMut.mutate(existing.id)}>Remove</Button>
                  </Box>
                ) : (
                  <Button size="small" variant="outlined" sx={{ fontSize: 9, minWidth: 0 }}
                    onClick={() => addReminderMut.mutate({
                      drugName: name, dose: m.dose ?? '', instructions: simplify(m),
                      reminderTime: groupTime, daysOfWeek: groupDays, medicationId: m.id ?? undefined,
                    })}>
                    + Reminder
                  </Button>
                )}
              </Box>
            </CardContent>
          </Card>
        )
      })}

      {/* Adherence section */}
      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Adherence Tracking</Typography>
      <TrackingPanel patientId={patientId} types={['meds']} title="" />
    </Box>
  )
}

export function _LegacyMedRemindersPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const [drugName, setDrugName] = React.useState('')
  const [dose, setDose] = React.useState('')
  const [instructions, setInstructions] = React.useState('')
  const [time, setTime] = React.useState('08:00')
  const [days, setDays] = React.useState([1,2,3,4,5,6,7])

  const { data: reminders, isLoading } = useQuery({
    queryKey: vivaKeys.reminders(patientId),
    queryFn: () => apiClient.get<unknown>(`patient-app/med-reminders/${patientId}`).then(r => readArrayField<ReminderRow>(r, 'reminders')),
  })

  const { data: medsData } = useQuery({
    queryKey: patientMedicationsKeys.byPatient(patientId),
    queryFn: () => apiClient.get<unknown>(`medications/patients/${patientId}/medications`).then(r => {
        const list = readArrayField<MedicationRow>(r, 'data')
        return list.filter((m) => m.status === 'active')
      }),
  })

  const addMut = useMutation({
    mutationFn: (data: { drugName: string; dose: string; instructions: string; reminderTime: string; daysOfWeek: number[] }) => apiClient.post(`patient-app/med-reminders/${patientId}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vivaKeys.reminders(patientId) }); setDrugName(''); setDose(''); setInstructions(''); },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiClient.delete(`patient-app/med-reminders/${patientId}/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: vivaKeys.reminders(patientId) }),
  })

  const dayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  // Auto-generate patient-centric instructions from drug name + dose
  const generateInstructions = (name: string, d: string) => {
    const dLower = d.toLowerCase()
    if (dLower.includes('nocte') || dLower.includes('night')) return `${name} ${d.replace(/nocte/i, '')} — take one tablet at night`
    if (dLower.includes('mane') || dLower.includes('morning')) return `${name} ${d.replace(/mane/i, '')} — take one tablet in the morning`
    if (dLower.includes('bd') || dLower.includes('twice')) return `${name} ${d.replace(/bd/i, '')} — take one tablet morning and night`
    if (dLower.includes('tds') || dLower.includes('three')) return `${name} ${d.replace(/tds/i, '')} — take one tablet three times a day`
    return `${name} ${d} — take as directed`
  }

  if (isLoading) return <CircularProgress size={24} />

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>Medication Reminders</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Set up reminders that appear as notifications in the patient's Viva app. Use patient-centric language.</Typography>

      {/* Existing reminders */}
      {(reminders ?? []).map((r, i: number) => (
        <Card key={r.id ?? `reminder-${i}`} variant="outlined" sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center' }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600}>{r.drugName} {r.dose}</Typography>
              <Typography variant="body2" sx={{ fontSize: 12, color: '#555' }}>{r.instructions}</Typography>
              <Typography variant="caption" color="text.secondary">{r.reminderTime} · {r.daysOfWeek?.map((d: number) => dayLabels[d-1]).join(', ')}</Typography>
            </Box>
            <Button size="small" color="error" onClick={() => r.id && deleteMut.mutate(r.id)}>Remove</Button>
          </CardContent>
        </Card>
      ))}

      {/* Quick add from current medications */}
      {medsData && medsData.length > 0 && (
        <Box sx={{ mt: 2, mb: 2 }}>
          <Typography variant="caption" color="text.secondary">Quick add from current medications:</Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
            {medsData.filter((m) => !(reminders ?? []).some((r) => r.drugName === (m.drugLabel ?? m.genericName))).map((m, i: number) => (
              <Chip key={m.id ?? `med-${i}`} size="small" label={`${m.drugLabel ?? m.genericName} ${m.dose ?? ''}`}
                onClick={() => {
                  const name = m.drugLabel ?? m.genericName ?? ''
                  const d = `${m.dose ?? ''} ${m.frequency ?? ''}`.trim()
                  setDrugName(name); setDose(d)
                  setInstructions(generateInstructions(name, d))
                }}
                sx={{ fontSize: 10, cursor: 'pointer' }} />
            ))}
          </Box>
        </Box>
      )}

      {/* Add form */}
      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>Add Reminder</Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <input value={drugName} onChange={e => { setDrugName(e.target.value); if (dose) setInstructions(generateInstructions(e.target.value, dose)) }}
              placeholder="Drug name" style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
            <input value={dose} onChange={e => { setDose(e.target.value); if (drugName) setInstructions(generateInstructions(drugName, e.target.value)) }}
              placeholder="Dose (e.g. 10mg nocte)" style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }} />
          </Box>
          <input value={instructions} onChange={e => setInstructions(e.target.value)}
            placeholder="Patient-friendly instructions" style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, marginBottom: 8 }} />
          <Box sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'center' }}>
            <Typography variant="caption" sx={{ mr: 1 }}>Time:</Typography>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} style={{ padding: '4px 8px', border: '1px solid #ddd', borderRadius: 6 }} />
            <Typography variant="caption" sx={{ mx: 1 }}>Days:</Typography>
            {dayLabels.map((d, i) => (
              <Chip key={i} size="small" label={d} variant={days.includes(i+1) ? 'filled' : 'outlined'}
                color={days.includes(i+1) ? 'primary' : 'default'}
                onClick={() => setDays(prev => prev.includes(i+1) ? prev.filter(x => x !== i+1) : [...prev, i+1])}
                sx={{ fontSize: 9, height: 22, cursor: 'pointer' }} />
            ))}
          </Box>
          <Button variant="contained" size="small" disabled={!drugName || !instructions || addMut.isPending}
            onClick={() => addMut.mutate({ drugName, dose, instructions, reminderTime: time, daysOfWeek: days })}
            sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>
            {addMut.isPending ? 'Adding...' : 'Add Reminder'}
          </Button>
        </CardContent>
      </Card>
    </Box>
  )
}

function SharedDocsPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const [title, setTitle] = React.useState('')
  const [url, setUrl] = React.useState('')
  const [docType, setDocType] = React.useState<'document' | 'weblink'>('weblink')

  const { data: docs, isLoading } = useQuery({
    queryKey: vivaKeys.docs(patientId),
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(`patient-app/shared-docs/${patientId}`)
      return readArrayField<SharedDocRow>(payload, 'documents')
    },
  })

  const addMut = useMutation({
    mutationFn: (data: { title: string; docType: 'document' | 'weblink'; url?: string }) =>
      apiClient.post(`patient-app/shared-docs/${patientId}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vivaKeys.docs(patientId) }); setTitle(''); setUrl(''); },
  })

  if (isLoading) return <CircularProgress size={24} />

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 2 }}>Share Documents with Patient</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Documents and web links shared here will appear in the patient's Viva app.</Typography>

      {(docs ?? []).map((d, i: number) => (
        <Card key={d.id ?? `doc-${i}`} variant="outlined" sx={{ mb: 1 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, display: 'flex', alignItems: 'center' }}>
            <Box sx={{ width: 28, height: 28, borderRadius: 1, bgcolor: d.docType === 'weblink' ? '#E3F2FD' : '#FFF3E0', display: 'flex', alignItems: 'center', justifyContent: 'center', mr: 1.5 }}>
              {d.docType === 'weblink' ? <span style={{ fontSize: 14 }}>🔗</span> : <span style={{ fontSize: 14 }}>📄</span>}
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={600}>{d.title}</Typography>
              {d.url && <Typography variant="caption" color="text.secondary" sx={{ wordBreak: 'break-all' }}>{d.url}</Typography>}
            </Box>
            <Typography variant="caption" color="text.secondary">{d.createdAt ? new Date(d.createdAt).toLocaleDateString('en-AU') : ''}</Typography>
          </CardContent>
        </Card>
      ))}

      <Card variant="outlined" sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="subtitle2" gutterBottom>Share New</Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <Chip label="Web Link" variant={docType === 'weblink' ? 'filled' : 'outlined'} color={docType === 'weblink' ? 'primary' : 'default'}
              onClick={() => setDocType('weblink')} size="small" sx={{ cursor: 'pointer' }} />
            <Chip label="Upload Document" variant={docType === 'document' ? 'filled' : 'outlined'} color={docType === 'document' ? 'primary' : 'default'}
              onClick={() => setDocType('document')} size="small" sx={{ cursor: 'pointer' }} />
          </Box>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document name / Title"
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, marginBottom: 8 }} />
          {docType === 'weblink' && <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..."
            style={{ width: '100%', padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13, marginBottom: 8 }} />}
          {docType === 'document' && (
            <Box sx={{ mb: 1 }}>
              <input type="file" id="viva-doc-upload" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0]
                  if (!file) return
                  if (!title) setTitle(file.name)
                  // Upload file to patient attachments
                  const formData = new FormData()
                  formData.append('files', file)
                  try {
                    const { apiClient: ac } = await import('../../../../../shared/services/apiClient')
                    await ac.instance.post(`patients/${patientId}/attachments`, formData, {
                      headers: { 'Content-Type': 'multipart/form-data' }
                    })
                    // Also create shared doc record
                    addMut.mutate({ title: title || file.name, docType: 'document' })
                  } catch (err) {
                    // BUG-520 — attachment-upload silent fail closed.
                    // Pre-fix: swallowed silently with comment claiming
                    // "handled by addMut" — but addMut runs AFTER the
                    // upload + only handles the doc-record-create
                    // failure path, not the upload itself. A failed
                    // multipart POST left the user thinking the file
                    // had uploaded.
                    const msg = err instanceof Error ? err.message : String(err)
                    console.error('BUG-520: attachment upload failed', { err, patientId })
                    alert(`Failed to upload attachment: ${msg}`)
                  }
                }} />
              <Button variant="outlined" size="small" startIcon={<UploadFileIcon sx={{ fontSize: 16 }} />}
                onClick={() => document.getElementById('viva-doc-upload')?.click()}
                sx={{ fontSize: 12 }}>
                Choose File
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>PDF, DOC, JPG, PNG</Typography>
            </Box>
          )}
          <Button variant="contained" size="small" disabled={!title || addMut.isPending}
            onClick={() => addMut.mutate({ title, docType, url: docType === 'weblink' ? url : undefined })}
            sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>
            {addMut.isPending ? 'Sharing...' : 'Share with Patient'}
          </Button>
        </CardContent>
      </Card>
    </Box>
  )
}

function AssessmentsPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const [selectedTemplate, setSelectedTemplate] = React.useState('')

  // Fetch self-rating templates
  const { data: templates } = useQuery({
    queryKey: patientsKeys.selfRatingTemplates(),
    queryFn: async () => {
      const payload = await apiClient.get<unknown>('patient-app/self-rating-templates')
      return readArrayField<SelfRatingTemplateRow>(payload, 'templates')
    },
  })

  // Fetch assigned assessments
  const { data: assessments, isLoading } = useQuery({
    queryKey: vivaKeys.assessments(patientId),
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(`patient-app/assessments/${patientId}`)
      return readArrayField<SelfRatingAssessmentRow>(payload, 'assessments')
    },
  })

  const assignMut = useMutation({
    mutationFn: () => apiClient.post(`patient-app/assessments/${patientId}/assign`, { templateId: selectedTemplate }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vivaKeys.assessments(patientId) }); setSelectedTemplate(''); },
  })

  if (isLoading) return <CircularProgress size={24} />

  const pending = (assessments ?? []).filter(a => a.status === 'pending')
  const completed = (assessments ?? []).filter(a => a.status === 'completed')

  // Build score history for graph (group by template_name)
  const scoreHistory: Record<string, Array<{ date: string; score: number }>> = {}
  for (const a of completed) {
    const name = a.templateName ?? a.measureType ?? 'Assessment'
    if (!scoreHistory[name]) scoreHistory[name] = []
    scoreHistory[name].push({ date: a.completedAt ?? a.createdAt ?? '', score: Number(a.totalScore ?? 0) })
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Self-Rating Assessments</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
        Assign self-rating scales from the dropdown. Patient completes them in Viva app and results sync back here.
      </Typography>

      {/* Assign new */}
      <Card variant="outlined" sx={{ mb: 2, bgcolor: '#f8f5fa' }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="caption" fontWeight={700}>Assign Self-Rating Scale</Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)}
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, fontSize: 13 }}>
              <option value="">Select a self-rating scale...</option>
              {(templates ?? []).map((t, i: number) => (
                <option key={t.id ?? `tmpl-${i}`} value={t.id ?? ''}>{t.name ?? 'Template'}</option>
              ))}
            </select>
            <Button variant="contained" size="small" disabled={!selectedTemplate || assignMut.isPending}
              onClick={() => assignMut.mutate()}
              sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' }, whiteSpace: 'nowrap' }}>
              {assignMut.isPending ? 'Assigning...' : 'Assign to Patient'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Pending */}
      {pending.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: '#E65100' }}>⏳ Pending ({pending.length})</Typography>
          {pending.map((a, i: number) => (
            <Card key={a.id ?? `pending-${i}`} variant="outlined" sx={{ mb: 1, borderLeft: '3px solid #FF9800' }}>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 }, display: 'flex', alignItems: 'center' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={600}>{a.templateName ?? a.measureType}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Assigned: {a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-AU') : ''}
                  </Typography>
                </Box>
                <Chip label="Pending" size="small" color="warning" sx={{ fontSize: 10 }} />
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Completed with scores */}
      {completed.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: '#2E7D32' }}>✅ Completed ({completed.length})</Typography>
          {completed.map((a, i: number) => (
            <Card key={a.id ?? `completed-${i}`} variant="outlined" sx={{ mb: 1, borderLeft: '3px solid #4CAF50' }}>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 }, display: 'flex', alignItems: 'center' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={600}>{a.templateName ?? a.measureType}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Completed: {a.completedAt ? new Date(a.completedAt).toLocaleDateString('en-AU') : a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-AU') : ''}
                  </Typography>
                </Box>
                <Typography variant="h6" fontWeight={800} sx={{ color: '#7B1FA2', mr: 1 }}>{a.totalScore}</Typography>
                <Chip label="Completed" size="small" color="success" sx={{ fontSize: 10 }} />
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Score trend graphs */}
      {Object.entries(scoreHistory).map(([name, scores]) => {
        if (scores.length < 2) return null
        const sorted = [...scores].sort((a, b) => a.date.localeCompare(b.date))
        return (
          <Card key={name} variant="outlined" sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#7B1FA2' }}>{name} — Score Trend</Typography>
              <Box sx={{ height: 100 }}>
                <svg width="100%" height="100" viewBox={`0 0 ${Math.max(sorted.length - 1, 1)} 100`} preserveAspectRatio="none">
                  <polyline
                    points={sorted.map((s, i) => {
                      const min = Math.min(...sorted.map(x => x.score)) * 0.9
                      const max = Math.max(...sorted.map(x => x.score)) * 1.1 || 1
                      return `${i},${95 - ((s.score - min) / (max - min)) * 90}`
                    }).join(' ')}
                    fill="none" stroke="#7B1FA2" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                  <polygon
                    points={`0,100 ${sorted.map((s, i) => {
                      const min = Math.min(...sorted.map(x => x.score)) * 0.9
                      const max = Math.max(...sorted.map(x => x.score)) * 1.1 || 1
                      return `${i},${95 - ((s.score - min) / (max - min)) * 90}`
                    }).join(' ')} ${sorted.length - 1},100`}
                    fill="#7B1FA2" opacity="0.08" />
                  {sorted.map((s, i) => {
                    const min = Math.min(...sorted.map(x => x.score)) * 0.9
                    const max = Math.max(...sorted.map(x => x.score)) * 1.1 || 1
                    const y = 95 - ((s.score - min) / (max - min)) * 90
                    return <circle key={i} cx={i} cy={y} r="3" fill="#7B1FA2" vectorEffect="non-scaling-stroke" />
                  })}
                </svg>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                {sorted.map((s, i) => (
                  <Box key={i} sx={{ textAlign: 'center' }}>
                    <Typography sx={{ fontSize: 10, fontWeight: 700, color: '#7B1FA2' }}>{s.score}</Typography>
                    <Typography sx={{ fontSize: 8, color: '#888' }}>{new Date(s.date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}</Typography>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        )
      })}

      {(assessments ?? []).length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>No assessments assigned yet. Use the dropdown above to assign a self-rating scale.</Typography>
      )}
    </Box>
  )
}

function DiaryPanel({ patientId }: { patientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: vivaKeys.trackingDiary(patientId),
    queryFn: async () => {
      const payload = await apiClient.get<VivaTrackingResponse>(`patient-app/tracking/${patientId}`, { type: 'diary', days: '90' })
      return payload.entries ?? []
    },
  })

  if (isLoading) return <CircularProgress size={24} />
  const entries: VivaTrackingEntry[] = data ?? []

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Diary Entries</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
        Private journal entries shared by the patient from their Viva app. {entries.length} entries.
      </Typography>
      {entries.length === 0 && <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No diary entries synced yet</Typography>}
      {entries.map((e, i: number) => {
        const parsed = parseJsonFromNote(e.note)
        const diary = isRecord(parsed) ? (parsed as VivaDiaryPayload) : null
        return (
          <Card key={i} variant="outlined" sx={{ mb: 1 }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="body2" fontWeight={600}>
                  {diary ? `${diary.mood ?? ''} ${diary.title ?? 'Entry'}`.trim() : 'Entry'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {e.recordedAt ? new Date(e.recordedAt).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                </Typography>
              </Box>
              <Typography variant="body2" sx={{ fontSize: 12, color: '#555', whiteSpace: 'pre-wrap' }}>
                {diary ? diary.content ?? '' : String(parsed ?? '')}
              </Typography>
            </CardContent>
          </Card>
        )
      })}
    </Box>
  )
}

function GoalsPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const [newGoal, setNewGoal] = React.useState('')
  const [newCategory, setNewCategory] = React.useState('Personal')

  const { data, isLoading } = useQuery({
    queryKey: vivaKeys.trackingGoal(patientId),
    queryFn: async () => {
      const payload = await apiClient.get<VivaTrackingResponse>(`patient-app/tracking/${patientId}`, { type: 'goal', days: '365' })
      return payload.entries ?? []
    },
  })

  const addGoalMut = useMutation({
    mutationFn: (goalData: GoalEntryPayload) => apiClient.post(`patient-app/tracking`, {
      entries: [{ type: 'goal', value: 0, note: JSON.stringify(goalData) }]
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vivaKeys.trackingGoal(patientId) }); setNewGoal(''); },
  })

  // Update goal status (refused/accepted)
  const updateGoalMut = useMutation({
    mutationFn: (data: { note: string }) =>
      apiClient.post(`patient-app/tracking`, { entries: [{ type: 'goal', value: 0, note: data.note }] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: vivaKeys.trackingGoal(patientId) }),
  })

  if (isLoading) return <CircularProgress size={24} />
  const entries: VivaTrackingEntry[] = data ?? []
  const categories = ['Personal', 'Exercise/Walking', 'Social', 'Health', 'Employment', 'Education', 'Housing', 'Relationships', 'Others']

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Recovery Goals</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
        Set goals collaboratively with the patient. They can track progress in Viva and indicate willingness to work on each goal.
      </Typography>

      {/* Add goal form */}
      <Card variant="outlined" sx={{ mb: 2, bgcolor: '#f8f5fa' }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="caption" fontWeight={700}>Add Goal (Clinician)</Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
            <input value={newGoal} onChange={e => setNewGoal(e.target.value)} placeholder="Recovery goal..."
              style={{ flex: 1, minWidth: 200, padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }} />
            <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <Button size="small" variant="contained" disabled={!newGoal.trim() || addGoalMut.isPending}
              onClick={() => addGoalMut.mutate({
                title: newGoal.trim(), category: newCategory, progress: 0, steps: [],
                createdAt: new Date().toISOString(), source: 'clinician',
              })}
              sx={{ fontSize: 11, bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' } }}>
              Add Goal
            </Button>
          </Box>
        </CardContent>
      </Card>

      {entries.length === 0 && <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No goals yet</Typography>}
      {entries.map((e, i: number) => {
        const parsedRaw = parseJsonFromNote(e.note)
        const parsed = isRecord(parsedRaw) ? (parsedRaw as GoalEntryPayload) : ({} as GoalEntryPayload)
        const progress = parsed.progress ?? 0
        const refused = parsed.refused === true
        const statusChanges = Array.isArray(parsed.statusChanges) ? parsed.statusChanges : []
        const steps = Array.isArray(parsed.steps) ? parsed.steps : []

        return (
          <Card key={e.id ?? `goal-${i}`} variant="outlined" sx={{ mb: 1, borderLeft: refused ? '3px solid #E53935' : progress >= 100 ? '3px solid #2E7D32' : '3px solid #7B1FA2' }}>
            <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Box sx={{ flex: 1 }}>
                  <Typography variant="body2" fontWeight={700}>{parsed.title ?? 'Goal'}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                    {parsed.category && <Chip label={parsed.category} size="small" sx={{ fontSize: 9 }} />}
                    {parsed.source === 'clinician' && <Chip label="Set by clinician" size="small" color="info" sx={{ fontSize: 9 }} />}
                    {refused && <Chip label="Patient declined" size="small" color="error" sx={{ fontSize: 9 }} />}
                  </Box>
                </Box>
                <Typography variant="body2" fontWeight={700} sx={{
                  color: progress >= 100 ? '#2E7D32' : refused ? '#E53935' : '#7B1FA2' }}>
                  {refused ? 'Declined' : `${progress}%`}
                </Typography>
              </Box>
              {!refused && <Box sx={{ mt: 1, height: 4, bgcolor: '#eee', borderRadius: 2 }}>
                <Box sx={{ height: 4, width: `${progress}%`, bgcolor: progress >= 100 ? '#2E7D32' : '#7B1FA2', borderRadius: 2 }} />
              </Box>}
              {steps.map((s, si: number) => (
                <Typography key={si} variant="body2" sx={{ fontSize: 11, color: s.done ? '#999' : '#333',
                  textDecoration: s.done ? 'line-through' : 'none', ml: 1, mt: 0.3 }}>
                  {s.done ? '✓' : '○'} {s.text}
                </Typography>
              ))}
              {/* Status change log */}
              {statusChanges.length > 0 && (
                <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid #eee' }}>
                  {statusChanges.map((sc, sci: number) => (
                    <Typography key={sci} variant="caption" sx={{ display: 'block', color: '#888', fontSize: 10 }}>
                      {sc.date ? new Date(sc.date).toLocaleString('en-AU') : ''} — {sc.action} by {sc.clinician ?? 'Patient'}
                    </Typography>
                  ))}
                </Box>
              )}
              {/* Clinician action buttons */}
              <Box sx={{ mt: 1, display: 'flex', gap: 0.5 }}>
                {!refused && (
                  <Button size="small" color="error" sx={{ fontSize: 9 }}
                    onClick={() => updateGoalMut.mutate({ note: JSON.stringify({
                      ...parsed, refused: true,
                      statusChanges: [...statusChanges, { action: 'Patient refused to work on this', date: new Date().toISOString(), clinician: 'Current user' }]
                    })})}>
                    Patient Refused
                  </Button>
                )}
                {refused && (
                  <Button size="small" color="success" sx={{ fontSize: 9 }}
                    onClick={() => updateGoalMut.mutate({ note: JSON.stringify({
                      ...parsed, refused: false,
                      statusChanges: [...statusChanges, { action: 'Changed to wanting to work on this', date: new Date().toISOString(), clinician: 'Current user' }]
                    })})}>
                    Patient Now Willing
                  </Button>
                )}
              </Box>
            </CardContent>
          </Card>
        )
      })}
    </Box>
  )
}

function ActivitiesPanel({ patientId }: { patientId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: vivaKeys.trackingActivity(patientId),
    queryFn: async () => {
      const payload = await apiClient.get<VivaTrackingResponse>(`patient-app/tracking/${patientId}`, { type: 'activity', days: '30' })
      return payload.entries ?? []
    },
  })

  if (isLoading) return <CircularProgress size={24} />
  const entries: VivaTrackingEntry[] = data ?? []
  const total = entries.length
  const done = entries.filter(e => Number(e.value) >= 1).length
  const rate = total > 0 ? Math.round(done / total * 100) : 0

  // Group by category
  const byCategory: Record<string, { total: number; done: number }> = {}
  for (const e of entries) {
    const parsed = parseJsonFromNote(e.note)
    const activity = isRecord(parsed) ? (parsed as VivaActivityPayload) : null
    const cat = activity?.category ?? 'Other'
    if (!byCategory[cat]) byCategory[cat] = { total: 0, done: 0 }
    byCategory[cat].total++
    if (Number(e.value) >= 1 || activity?.done) byCategory[cat].done++
  }

  // Group by date for daily completion chart
  const byDate: Record<string, { total: number; done: number }> = {}
  for (const e of entries) {
    const parsed = parseJsonFromNote(e.note)
    const activity = isRecord(parsed) ? (parsed as VivaActivityPayload) : null
    const dateKey = e.recordedAt ? new Date(e.recordedAt).toISOString().split('T')[0] : 'unknown'
    if (!byDate[dateKey]) byDate[dateKey] = { total: 0, done: 0 }
    byDate[dateKey].total++
    if (Number(e.value) >= 1 || activity?.done) byDate[dateKey].done++
  }
  const dailyData = Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b))

  const catColors: Record<string, string> = {
    'Self-care': '#FF6F00', 'Exercise': '#43A047', 'Social': '#0288D1',
    'Pleasure': '#6A1B9A', 'Wellbeing': '#5C6BC0', 'Work': '#F57C00', 'Other': '#999',
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Activity Schedule</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
        Activities synced from patient's Viva app. BACE-style behavioural activation tracking.
      </Typography>

      {/* Summary stats */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <Card variant="outlined" sx={{ flex: 1, textAlign: 'center', py: 1.5 }}>
          <Typography variant="h5" fontWeight={800} sx={{ color: '#7B1FA2' }}>{total}</Typography>
          <Typography variant="caption" color="text.secondary">Total</Typography>
        </Card>
        <Card variant="outlined" sx={{ flex: 1, textAlign: 'center', py: 1.5 }}>
          <Typography variant="h5" fontWeight={800} sx={{ color: '#2E7D32' }}>{done}</Typography>
          <Typography variant="caption" color="text.secondary">Completed</Typography>
        </Card>
        <Card variant="outlined" sx={{ flex: 1, textAlign: 'center', py: 1.5 }}>
          <Typography variant="h5" fontWeight={800} sx={{ color: rate >= 70 ? '#2E7D32' : rate >= 40 ? '#F57C00' : '#D32F2F' }}>{rate}%</Typography>
          <Typography variant="caption" color="text.secondary">Completion</Typography>
        </Card>
      </Box>

      {/* Daily completion chart */}
      {dailyData.length >= 2 && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Daily Completion</Typography>
            <Box sx={{ height: 80 }}>
              <svg width="100%" height="80" viewBox={`0 0 ${Math.max(dailyData.length - 1, 1)} 100`} preserveAspectRatio="none">
                <polyline points={dailyData.map(([_, d], i) => {
                  const pct = d.total > 0 ? (d.done / d.total) * 100 : 0
                  return `${i},${100 - pct}`
                }).join(' ')} fill="none" stroke="#7B1FA2" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
                <polygon points={`0,100 ${dailyData.map(([_, d], i) => {
                  const pct = d.total > 0 ? (d.done / d.total) * 100 : 0
                  return `${i},${100 - pct}`
                }).join(' ')} ${dailyData.length - 1},100`} fill="#7B1FA2" opacity="0.08" />
              </svg>
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
              {dailyData.filter((_, i) => i % Math.ceil(dailyData.length / 6) === 0 || i === dailyData.length - 1).map(([date]) => (
                <Typography key={date} sx={{ fontSize: 8, color: '#888' }}>{new Date(date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}</Typography>
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Category breakdown */}
      {Object.keys(byCategory).length > 0 && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>By Category</Typography>
            {Object.entries(byCategory).map(([cat, stats]) => {
              const pct = stats.total > 0 ? Math.round(stats.done / stats.total * 100) : 0
              const color = catColors[cat] ?? '#999'
              return (
                <Box key={cat} sx={{ mb: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 600 }}>{cat}</Typography>
                    <Typography sx={{ fontSize: 11, color }}>{stats.done}/{stats.total} ({pct}%)</Typography>
                  </Box>
                  <Box sx={{ height: 6, bgcolor: '#eee', borderRadius: 3 }}>
                    <Box sx={{ height: 6, width: `${pct}%`, bgcolor: color, borderRadius: 3 }} />
                  </Box>
                </Box>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* Activity list */}
      {entries.length === 0 && <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No activities synced from Viva app yet</Typography>}
      {entries.length > 0 && (
        <Card variant="outlined">
          <CardContent sx={{ py: 1, '&:last-child': { pb: 1 } }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Recent Activities</Typography>
            {entries.slice(0, 30).map((e, i: number) => {
              const parsed = parseJsonFromNote(e.note)
              const activity = isRecord(parsed) ? (parsed as VivaActivityPayload) : null
              const isDone = Number(e.value) >= 1 || activity?.done === true
              return (
                <Box key={i} sx={{ display: 'flex', alignItems: 'center', py: 0.4, borderBottom: '1px solid #f5f5f5' }}>
                  <Typography sx={{ fontSize: 13, mr: 1, width: 18 }}>{isDone ? '✅' : '⬜'}</Typography>
                  {activity?.time && <Typography sx={{ fontSize: 11, fontWeight: 600, mr: 1, width: 36, color: '#555' }}>{activity.time}</Typography>}
                  <Typography sx={{ fontSize: 11, flex: 1, color: isDone ? '#999' : '#333', textDecoration: isDone ? 'line-through' : 'none' }}>
                    {activity?.name ?? 'Activity'}
                  </Typography>
                  {activity?.category && <Chip label={activity.category} size="small" sx={{ fontSize: 8, height: 18, bgcolor: (catColors[activity.category] ?? '#999') + '15', color: catColors[activity.category] ?? '#999' }} />}
                </Box>
              )
            })}
          </CardContent>
        </Card>
      )}
    </Box>
  )
}

function ProfileComparisonPanel({ patientId }: { patientId: string }) {
  const { data: vivaProfile, isLoading: vivaLoading } = useQuery({
    queryKey: vivaKeys.trackingProfile(patientId),
    queryFn: async () => {
      const payload = await apiClient.get<VivaTrackingResponse>(`patient-app/tracking/${patientId}`, { type: 'profile', days: '90' })
      const entries = payload.entries ?? []
      if (entries.length === 0) return null
      const parsed = parseJsonFromNote(entries[0].note)
      return isRecord(parsed) ? parsed : null
    },
  })

  const { data: desktopPatient, isLoading: desktopLoading } = useQuery({
    queryKey: patientsKeys.detailMeta(patientId),
    queryFn: () => apiClient.get<unknown>(`patients/${patientId}`),
  })

  if (vivaLoading || desktopLoading) return <CircularProgress size={24} />

  // Compare fields
  const diffs: Array<{ field: string; viva: string; desktop: string }> = []
  if (vivaProfile && isRecord(desktopPatient)) {
    const comparisons = [
      { key: 'phone', vivaKey: 'phone', desktopKey: 'phoneMobile', label: 'Phone' },
      { key: 'email', vivaKey: 'email', desktopKey: 'emailPrimary', label: 'Email' },
      { key: 'address', vivaKey: 'address', desktopKey: 'addressStreet', label: 'Address' },
      { key: 'nokName', vivaKey: 'nokName', desktopKey: 'nokName', label: 'Next of Kin Name' },
      { key: 'nokPhone', vivaKey: 'nokPhone', desktopKey: 'nokPhone', label: 'Next of Kin Phone' },
      { key: 'gpName', vivaKey: 'gpName', desktopKey: 'gpName', label: 'GP Name' },
      { key: 'gpPhone', vivaKey: 'gpPhone', desktopKey: 'gpPhone', label: 'GP Phone' },
    ]
    for (const c of comparisons) {
      const vivaRaw = vivaProfile[c.vivaKey]
      const desktopRaw = desktopPatient[c.desktopKey]
      const vivaVal = (typeof vivaRaw === 'string' ? vivaRaw : '').trim()
      const desktopVal = (typeof desktopRaw === 'string' ? desktopRaw : '').trim()
      if (vivaVal && desktopVal && vivaVal.toLowerCase() !== desktopVal.toLowerCase()) {
        diffs.push({ field: c.label, viva: vivaVal, desktop: desktopVal })
      }
    }

    // Check for new fields in Viva not in desktop
    const vivaDrugAllergies = typeof vivaProfile.drugAllergies === 'string' ? vivaProfile.drugAllergies : ''
    const desktopDrugAllergies = typeof desktopPatient.drugAllergies === 'string' ? desktopPatient.drugAllergies : ''
    if (vivaDrugAllergies && !desktopDrugAllergies) {
      diffs.push({ field: 'Drug Allergies', viva: vivaDrugAllergies, desktop: 'Not recorded' })
    }
    const vivaNokConsent = typeof vivaProfile.nokConsent === 'string' ? vivaProfile.nokConsent : ''
    if (vivaNokConsent) {
      diffs.push({ field: 'NOK Consent Preference', viva: vivaNokConsent, desktop: 'Not set' })
    }
    const vivaSupportConsent = typeof vivaProfile.supportConsent === 'string' ? vivaProfile.supportConsent : ''
    if (vivaSupportConsent) {
      diffs.push({ field: 'Support Person Consent', viva: vivaSupportConsent, desktop: 'Not set' })
    }
  }

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Profile & Consent</Typography>

      {/* Difference alerts */}
      {diffs.length > 0 && (
        <Card sx={{ mb: 2, bgcolor: '#FFF3E0', border: '1px solid #FFB74D' }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <span style={{ fontSize: 16, marginRight: 6 }}>⚠️</span>
              <Typography variant="subtitle2" fontWeight={700} sx={{ color: '#E65100' }}>
                {diffs.length} Difference{diffs.length > 1 ? 's' : ''} Found Between Viva App & Desktop Records
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              Patient updated their information via Viva app. Review differences and update desktop records as needed.
            </Typography>
            {diffs.map((d, i) => (
              <Box key={i} sx={{ display: 'flex', py: 0.5, borderBottom: '1px solid #FFE0B2' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 600, width: 140 }}>{d.field}</Typography>
                <Box sx={{ flex: 1 }}>
                  <Typography sx={{ fontSize: 11, color: '#E65100' }}>Viva: {d.viva}</Typography>
                  <Typography sx={{ fontSize: 11, color: '#666' }}>Desktop: {d.desktop}</Typography>
                </Box>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}

      {diffs.length === 0 && vivaProfile && (
        <Box sx={{ p: 1.5, mb: 2, bgcolor: '#E8F5E9', borderRadius: 2 }}>
          <Typography variant="body2" sx={{ fontSize: 12, color: '#2E7D32' }}>✓ No discrepancies between Viva app and desktop records</Typography>
        </Box>
      )}

      {/* Viva profile data */}
      {!vivaProfile ? (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>No profile data synced from Viva app yet</Typography>
      ) : (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>Patient-Reported Profile (from Viva App)</Typography>
            {Object.entries(vivaProfile).filter(([_, v]) => v && String(v).length > 0).map(([k, v]) => (
              <Box key={k} sx={{ display: 'flex', py: 0.3 }}>
                <Typography variant="body2" sx={{ width: 160, fontSize: 11, color: '#888' }}>
                  {k.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}
                </Typography>
                <Typography variant="body2" sx={{ fontSize: 12 }}>{String(v)}</Typography>
              </Box>
            ))}
          </CardContent>
        </Card>
      )}
    </Box>
  )
}

function PatientTasksPanel({ patientId }: { patientId: string }) {
  const qc = useQueryClient()
  const [newTask, setNewTask] = React.useState('')
  const [newDue, setNewDue] = React.useState('')

  const { data: tasks, isLoading } = useQuery({
    queryKey: vivaKeys.patientTasks(patientId),
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(`patient-app/tasks/${patientId}`)
      return readArrayField<PatientTaskRow>(payload, 'tasks')
    },
  })

  const { data: checklists } = useQuery({
    queryKey: vivaKeys.checklists(patientId),
    queryFn: async () => {
      const payload = await apiClient.get<unknown>(`patient-app/checklists/${patientId}`)
      return readArrayField<PatientChecklistRow>(payload, 'checklists')
    },
  })

  const addTask = useMutation({
    mutationFn: (data: { title: string; dueDate?: string }) => apiClient.post(`patient-app/tasks/${patientId}`, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: vivaKeys.patientTasks(patientId) }); setNewTask(''); setNewDue(''); },
  })

  if (isLoading) return <CircularProgress size={24} />
  const pending = (tasks ?? []).filter(t => t.status === 'pending')
  const completed = (tasks ?? []).filter(t => t.status === 'completed')

  return (
    <Box>
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Patient Tasks</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: 12 }}>
        Assign tasks for the patient. They appear in the Viva app with reminders.
      </Typography>

      {/* Add task */}
      <Card variant="outlined" sx={{ mb: 2, bgcolor: '#f8f5fa' }}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography variant="caption" fontWeight={700}>Add Task</Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <input value={newTask} onChange={e => setNewTask(e.target.value)} placeholder="e.g. Check with Centrelink, Bring documents..."
              style={{ flex: 1, padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }} />
            <input type="date" value={newDue} onChange={e => setNewDue(e.target.value)}
              style={{ padding: '6px 10px', border: '1px solid #ddd', borderRadius: 6, fontSize: 12 }} />
            <Button size="small" variant="contained" disabled={!newTask.trim() || addTask.isPending}
              onClick={() => addTask.mutate({ title: newTask.trim(), dueDate: newDue || undefined })}
              sx={{ bgcolor: '#7B1FA2', '&:hover': { bgcolor: '#6A1B9A' }, fontSize: 11 }}>
              Add
            </Button>
          </Box>
        </CardContent>
      </Card>

      {/* Pending tasks */}
      {pending.map((t, i: number) => (
        <Box key={t.id ?? `task-pending-${i}`} sx={{ display: 'flex', alignItems: 'center', py: 0.5, borderBottom: '1px solid #f5f5f5' }}>
          <Typography sx={{ fontSize: 13, mr: 1 }}>⬜</Typography>
          <Typography sx={{ fontSize: 12, flex: 1 }}>{t.title}</Typography>
          {t.dueDate && <Typography sx={{ fontSize: 10, color: '#888' }}>{new Date(t.dueDate).toLocaleDateString('en-AU')}</Typography>}
        </Box>
      ))}
      {completed.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">{completed.length} completed</Typography>
          {completed.slice(0, 5).map((t, i: number) => (
            <Box key={t.id ?? `task-completed-${i}`} sx={{ display: 'flex', alignItems: 'center', py: 0.3 }}>
              <Typography sx={{ fontSize: 13, mr: 1 }}>✅</Typography>
              <Typography sx={{ fontSize: 11, color: '#999', textDecoration: 'line-through' }}>{t.title}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {/* Appointment Checklists (view only — created from Appointments tab) */}
      {(checklists ?? []).length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Pre-Appointment Checklists</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Created from the Appointments tab. Patient completes in Viva app.
          </Typography>
          {(checklists ?? []).map((c, i: number) => (
            <Box key={c.id ?? `checklist-${i}`} sx={{ display: 'flex', alignItems: 'center', py: 0.4, borderBottom: '1px solid #f5f5f5' }}>
              <Typography sx={{ fontSize: 13, mr: 1 }}>{c.isCompleted ? '✅' : '⬜'}</Typography>
              <Typography sx={{ fontSize: 12, flex: 1, color: c.isCompleted ? '#999' : '#333',
                textDecoration: c.isCompleted ? 'line-through' : 'none' }}>{c.item}</Typography>
            </Box>
          ))}
        </>
      )}
    </Box>
  )
}

export default VivaTab

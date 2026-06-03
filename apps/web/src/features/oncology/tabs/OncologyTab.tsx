/**
 * apps/web/src/features/oncology/tabs/OncologyTab.tsx
 *
 * Phase 8 — Oncology patient-detail tab. Gated by the module-registry
 * entry `oncology.module` so it only renders when the visibility
 * intersection (clinic ∩ staff ∩ patient active episodes) contains
 * `oncology` (or when the user is admin / superadmin, per the
 * role-bypass in computeVisibleSpecialties).
 *
 * Seven sub-sections surface the six mCODE-aligned tables plus the
 * shared clinical-notes surface:
 *
 *   1. Primary cancer conditions + "Select" action per row
 *      so the condition-scoped sections below reflect the pick.
 *   2. ECOG performance status history (with "Record ECOG" dialog).
 *   3. TNM stage groups for the selected condition
 *      (with "Add stage group" dialog).
 *   4. Treatment plans for the selected condition
 *      (with "Add treatment plan" dialog).
 *   5. Tumour board decisions for the selected condition
 *      (with "Record decision" dialog).
 *   6. Clinical notes — embeds the shared ClinicalNotesPanel scoped
 *      to the selected condition's linked episode. Reuses the same
 *      SOAP editor, template insertion, sign-off + amendment chain,
 *      AI scribe and print that every other specialty uses. If the
 *      selected condition has no episode link, an explanatory Alert
 *      points the clinician at the Episodes tab.
 *   7. Chemo cycles — surfaced per treatment plan in a follow-up PR;
 *      backend is already wired at
 *      POST /oncology/cycles + GET /oncology/treatment-plans/:id/cycles.
 */
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import React from 'react'
import { apiClient } from '../../../shared/services/apiClient'
import { ClinicalNotesPanel } from '../../clinical-notes/components/ClinicalNotesPanel'

interface OncologyTabProps {
  patientId: string
}

interface Condition {
  id: string
  episodeId: string | null
  diagnosisDate: string
  icd10: string | null
  snomed: string | null
  histology: string | null
  laterality: string | null
  stageSystem: string | null
  notes: string | null
}

interface Tnm {
  id: string
  t: string | null
  n: string | null
  m: string | null
  stageGroup: string | null
  stagedAt: string
  notes: string | null
}

interface Ecog {
  id: string
  score: number
  assessedAt: string
  notes: string | null
}

interface TreatmentPlan {
  id: string
  conditionId: string
  regimenName: string
  intent: string
  protocolRef: string | null
  startDate: string
  endDate: string | null
  status: string
}

interface Decision {
  id: string
  meetingDate: string
  recommendation: string
  rationale: string | null
}

import { oncologyKeys } from '../queryKeys'

export const OncologyTab: React.FC<OncologyTabProps> = ({ patientId }) => {
  const qc = useQueryClient()
  const [addConditionOpen, setAddConditionOpen] = React.useState(false)
  const [addEcogOpen, setAddEcogOpen] = React.useState(false)
  const [addTnmOpen, setAddTnmOpen] = React.useState(false)
  const [addPlanOpen, setAddPlanOpen] = React.useState(false)
  const [addDecisionOpen, setAddDecisionOpen] = React.useState(false)
  const [selectedConditionId, setSelectedConditionId] = React.useState<string | null>(null)

  // ── Conditions ─────────────────────────────────────────────────────
  const conditionsQ = useQuery({
    queryKey: oncologyKeys.conditions(patientId),
    queryFn: () =>
      apiClient.get<{ items: Condition[] }>(`oncology/patients/${patientId}/conditions`),
  })
  const conditions = conditionsQ.data?.items ?? []

  React.useEffect(() => {
    if (!selectedConditionId && conditions.length > 0) {
      setSelectedConditionId(conditions[0].id)
    }
  }, [conditions, selectedConditionId])

  const addConditionMut = useMutation({
    mutationFn: (dto: {
      patientId: string
      diagnosisDate: string
      icd10?: string
      snomed?: string
      histology?: string
      laterality?: string
      notes?: string
    }) =>
      apiClient.post<{ item: Condition }>('oncology/conditions', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: oncologyKeys.conditions(patientId) })
      setAddConditionOpen(false)
    },
  })

  // ── ECOG ──────────────────────────────────────────────────────────
  const ecogQ = useQuery({
    queryKey: oncologyKeys.ecog(patientId),
    queryFn: () =>
      apiClient.get<{ items: Ecog[] }>(`oncology/patients/${patientId}/ecog`),
  })
  const ecogHistory = ecogQ.data?.items ?? []

  const addEcogMut = useMutation({
    mutationFn: (dto: { patientId: string; score: number; assessedAt: string; notes?: string }) =>
      apiClient.post('oncology/ecog', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: oncologyKeys.ecog(patientId) })
      setAddEcogOpen(false)
    },
  })

  // ── TNM (latest per selected condition) ───────────────────────────
  const tnmQ = useQuery({
    queryKey: oncologyKeys.tnm(selectedConditionId ?? ''),
    queryFn: () =>
      apiClient.get<{ items: Tnm[] }>(
        `oncology/conditions/${selectedConditionId}/stage-groups`,
      ),
    enabled: !!selectedConditionId,
  })
  const tnm = tnmQ.data?.items ?? []

  // ── Treatment plans ───────────────────────────────────────────────
  const plansQ = useQuery({
    queryKey: oncologyKeys.plans(selectedConditionId ?? ''),
    queryFn: () =>
      apiClient.get<{ items: TreatmentPlan[] }>(
        `oncology/conditions/${selectedConditionId}/treatment-plans`,
      ),
    enabled: !!selectedConditionId,
  })
  const plans = plansQ.data?.items ?? []

  // ── Tumour board ──────────────────────────────────────────────────
  const decisionsQ = useQuery({
    queryKey: oncologyKeys.decisions(selectedConditionId ?? ''),
    queryFn: () =>
      apiClient.get<{ items: Decision[] }>(
        `oncology/conditions/${selectedConditionId}/tumour-board`,
      ),
    enabled: !!selectedConditionId,
  })
  const decisions = decisionsQ.data?.items ?? []

  // ── Mutations: TNM / treatment plan / tumour board decision ──────
  const addTnmMut = useMutation({
    mutationFn: (dto: {
      conditionId: string
      t?: string
      n?: string
      m?: string
      stageGroup?: string
      notes?: string
    }) => apiClient.post<{ item: Tnm }>('oncology/stage-groups', dto),
    onSuccess: () => {
      if (selectedConditionId) {
        qc.invalidateQueries({ queryKey: oncologyKeys.tnm(selectedConditionId) })
      }
      setAddTnmOpen(false)
    },
  })

  const addPlanMut = useMutation({
    mutationFn: (dto: {
      conditionId: string
      regimenName: string
      intent: 'curative' | 'palliative' | 'adjuvant' | 'neoadjuvant'
      protocolRef?: string
      startDate: string
      endDate?: string
      notes?: string
    }) => apiClient.post<{ item: TreatmentPlan }>('oncology/treatment-plans', dto),
    onSuccess: () => {
      if (selectedConditionId) {
        qc.invalidateQueries({ queryKey: oncologyKeys.plans(selectedConditionId) })
      }
      setAddPlanOpen(false)
    },
  })

  const addDecisionMut = useMutation({
    mutationFn: (dto: {
      conditionId: string
      meetingDate: string
      recommendation: string
      rationale?: string
    }) => apiClient.post<{ item: Decision }>('oncology/tumour-board', dto),
    onSuccess: () => {
      if (selectedConditionId) {
        qc.invalidateQueries({ queryKey: oncologyKeys.decisions(selectedConditionId) })
      }
      setAddDecisionOpen(false)
    },
  })

  // Condition currently in focus — resolved so the "Clinical notes"
  // embed below can pass its episode id (if any) into
  // ClinicalNotesPanel.
  const selectedCondition = conditions.find((c) => c.id === selectedConditionId) ?? null

  if (conditionsQ.isLoading) {
    return (
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" fontWeight={700}>
            Oncology
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Cancer journey, TNM staging, ECOG, treatment plans, chemo cycles, and tumour board
            decisions. Aligned with the HL7 mCODE FHIR profile set.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={() => setAddEcogOpen(true)}>
            Record ECOG
          </Button>
          <Button variant="contained" onClick={() => setAddConditionOpen(true)}>
            Add cancer condition
          </Button>
        </Stack>
      </Stack>

      <Divider sx={{ mb: 3 }} />

      {/* ── Conditions ─────────────────────────────────────── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
        Primary cancer conditions
      </Typography>
      {conditions.length === 0 ? (
        <Alert severity="info" sx={{ mb: 3 }}>
          No cancer conditions recorded for this patient.
        </Alert>
      ) : (
        <Paper variant="outlined" sx={{ mb: 3 }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Diagnosis date</TableCell>
                  <TableCell>ICD-10</TableCell>
                  <TableCell>SNOMED</TableCell>
                  <TableCell>Histology</TableCell>
                  <TableCell>Laterality</TableCell>
                  <TableCell align="right">Select</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {conditions.map((c) => {
                  const isSelected = c.id === selectedConditionId
                  return (
                    <TableRow
                      key={c.id}
                      hover
                      selected={isSelected}
                      sx={{
                        bgcolor: isSelected ? 'rgba(184, 98, 26, 0.08)' : undefined,
                      }}
                    >
                      <TableCell>{c.diagnosisDate}</TableCell>
                      <TableCell>{c.icd10 ?? '—'}</TableCell>
                      <TableCell>{c.snomed ?? '—'}</TableCell>
                      <TableCell>{c.histology ?? '—'}</TableCell>
                      <TableCell>{c.laterality ?? '—'}</TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          variant={isSelected ? 'contained' : 'outlined'}
                          color="primary"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedConditionId(c.id)
                          }}
                          disabled={isSelected}
                          sx={{ minWidth: 100 }}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* ── ECOG ─────────────────────────────────────────────── */}
      <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
        ECOG performance status
      </Typography>
      {ecogHistory.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          No ECOG assessments recorded.
        </Typography>
      ) : (
        <Paper variant="outlined" sx={{ mb: 3 }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Assessed at</TableCell>
                  <TableCell>Score (0–5)</TableCell>
                  <TableCell>Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {ecogHistory.map((e) => (
                  <TableRow key={e.id} hover>
                    <TableCell>{new Date(e.assessedAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <Chip label={e.score} size="small" color={e.score <= 1 ? 'success' : e.score <= 3 ? 'warning' : 'error'} />
                    </TableCell>
                    <TableCell>{e.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* ── Condition-scoped sections ────────────────────────── */}
      {selectedConditionId && (
        <>
          <Divider sx={{ my: 3 }} />

          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6" fontWeight={600}>
              TNM staging (selected condition)
            </Typography>
            <Button size="small" variant="outlined" onClick={() => setAddTnmOpen(true)}>
              Add stage group
            </Button>
          </Stack>
          {tnm.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              No stage groups recorded.
            </Typography>
          ) : (
            <Paper variant="outlined" sx={{ mb: 3 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>T</TableCell>
                      <TableCell>N</TableCell>
                      <TableCell>M</TableCell>
                      <TableCell>Stage</TableCell>
                      <TableCell>Staged at</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tnm.map((t) => (
                      <TableRow key={t.id}>
                        <TableCell>{t.t ?? '—'}</TableCell>
                        <TableCell>{t.n ?? '—'}</TableCell>
                        <TableCell>{t.m ?? '—'}</TableCell>
                        <TableCell><strong>{t.stageGroup ?? '—'}</strong></TableCell>
                        <TableCell>{new Date(t.stagedAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6" fontWeight={600}>
              Treatment plans
            </Typography>
            <Button size="small" variant="outlined" onClick={() => setAddPlanOpen(true)}>
              Add treatment plan
            </Button>
          </Stack>
          {plans.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              No treatment plans recorded.
            </Typography>
          ) : (
            <Paper variant="outlined" sx={{ mb: 3 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Regimen</TableCell>
                      <TableCell>Intent</TableCell>
                      <TableCell>Protocol</TableCell>
                      <TableCell>Start</TableCell>
                      <TableCell>End</TableCell>
                      <TableCell>Status</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {plans.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{p.regimenName}</TableCell>
                        <TableCell><Chip label={p.intent} size="small" /></TableCell>
                        <TableCell>{p.protocolRef ?? '—'}</TableCell>
                        <TableCell>{p.startDate}</TableCell>
                        <TableCell>{p.endDate ?? '—'}</TableCell>
                        <TableCell>{p.status}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
            <Typography variant="h6" fontWeight={600}>
              Tumour board decisions
            </Typography>
            <Button size="small" variant="outlined" onClick={() => setAddDecisionOpen(true)}>
              Record decision
            </Button>
          </Stack>
          {decisions.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              No tumour board decisions recorded.
            </Typography>
          ) : (
            <Paper variant="outlined" sx={{ mb: 3 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Meeting date</TableCell>
                      <TableCell>Recommendation</TableCell>
                      <TableCell>Rationale</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {decisions.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.meetingDate}</TableCell>
                        <TableCell>{d.recommendation}</TableCell>
                        <TableCell>{d.rationale ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* ── Clinical notes (scoped to the selected condition's episode) ── */}
          <Divider sx={{ my: 3 }} />
          <Typography variant="h6" fontWeight={600} sx={{ mb: 1 }}>
            Clinical notes
          </Typography>
          {selectedCondition?.episodeId ? (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                Notes scoped to this cancer condition's episode. Reuses the same
                clinical-notes surface as every other specialty — template insertion,
                SOAP editor, sign-off + amendments, AI scribe and print all work here.
              </Typography>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <ClinicalNotesPanel
                  patientId={patientId}
                  episodeId={selectedCondition.episodeId}
                />
              </Paper>
            </>
          ) : (
            <Alert severity="info">
              This cancer condition has no linked episode. Open an oncology episode on
              the Episodes tab first — clinical notes will then appear here automatically.
            </Alert>
          )}
        </>
      )}

      {/* ── Add condition dialog ─────────────────────────────── */}
      <AddConditionDialog
        open={addConditionOpen}
        onClose={() => setAddConditionOpen(false)}
        patientId={patientId}
        onSubmit={(dto) => addConditionMut.mutate(dto)}
        saving={addConditionMut.isPending}
        error={addConditionMut.error instanceof Error ? addConditionMut.error.message : null}
      />

      {/* ── Add ECOG dialog ──────────────────────────────────── */}
      <AddEcogDialog
        open={addEcogOpen}
        onClose={() => setAddEcogOpen(false)}
        patientId={patientId}
        onSubmit={(dto) => addEcogMut.mutate(dto)}
        saving={addEcogMut.isPending}
        error={addEcogMut.error instanceof Error ? addEcogMut.error.message : null}
      />

      {/* ── Add TNM stage group dialog ───────────────────────── */}
      {selectedConditionId && (
        <AddTnmDialog
          open={addTnmOpen}
          onClose={() => setAddTnmOpen(false)}
          conditionId={selectedConditionId}
          onSubmit={(dto) => addTnmMut.mutate(dto)}
          saving={addTnmMut.isPending}
          error={addTnmMut.error instanceof Error ? addTnmMut.error.message : null}
        />
      )}

      {/* ── Add treatment plan dialog ────────────────────────── */}
      {selectedConditionId && (
        <AddTreatmentPlanDialog
          open={addPlanOpen}
          onClose={() => setAddPlanOpen(false)}
          conditionId={selectedConditionId}
          onSubmit={(dto) => addPlanMut.mutate(dto)}
          saving={addPlanMut.isPending}
          error={addPlanMut.error instanceof Error ? addPlanMut.error.message : null}
        />
      )}

      {/* ── Add tumour board decision dialog ─────────────────── */}
      {selectedConditionId && (
        <AddDecisionDialog
          open={addDecisionOpen}
          onClose={() => setAddDecisionOpen(false)}
          conditionId={selectedConditionId}
          onSubmit={(dto) => addDecisionMut.mutate(dto)}
          saving={addDecisionMut.isPending}
          error={addDecisionMut.error instanceof Error ? addDecisionMut.error.message : null}
        />
      )}
    </Box>
  )
}

// ── Add condition dialog ───────────────────────────────────────────

const AddConditionDialog: React.FC<{
  open: boolean
  onClose: () => void
  patientId: string
  onSubmit: (dto: {
    patientId: string
    diagnosisDate: string
    icd10?: string
    snomed?: string
    histology?: string
    laterality?: string
    notes?: string
  }) => void
  saving: boolean
  error: string | null
}> = ({ open, onClose, patientId, onSubmit, saving, error }) => {
  const [diagnosisDate, setDiagnosisDate] = React.useState(
    new Date().toISOString().split('T')[0],
  )
  const [icd10, setIcd10] = React.useState('')
  const [snomed, setSnomed] = React.useState('')
  const [histology, setHistology] = React.useState('')
  const [laterality, setLaterality] = React.useState('n/a')
  const [notes, setNotes] = React.useState('')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add cancer condition</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Diagnosis date"
            type="date"
            value={diagnosisDate}
            onChange={(e) => setDiagnosisDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            required
          />
          <TextField label="ICD-10" value={icd10} onChange={(e) => setIcd10(e.target.value)} />
          <TextField label="SNOMED" value={snomed} onChange={(e) => setSnomed(e.target.value)} />
          <TextField label="Histology" value={histology} onChange={(e) => setHistology(e.target.value)} />
          <TextField
            select
            label="Laterality"
            value={laterality}
            onChange={(e) => setLaterality(e.target.value)}
          >
            <MenuItem value="n/a">N/A</MenuItem>
            <MenuItem value="left">Left</MenuItem>
            <MenuItem value="right">Right</MenuItem>
            <MenuItem value="bilateral">Bilateral</MenuItem>
          </TextField>
          <TextField label="Notes" multiline rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !diagnosisDate}
          onClick={() =>
            onSubmit({
              patientId,
              diagnosisDate,
              icd10: icd10.trim() || undefined,
              snomed: snomed.trim() || undefined,
              histology: histology.trim() || undefined,
              laterality,
              notes: notes.trim() || undefined,
            })
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Add ECOG dialog ────────────────────────────────────────────────

const AddEcogDialog: React.FC<{
  open: boolean
  onClose: () => void
  patientId: string
  onSubmit: (dto: { patientId: string; score: number; assessedAt: string; notes?: string }) => void
  saving: boolean
  error: string | null
}> = ({ open, onClose, patientId, onSubmit, saving, error }) => {
  const [score, setScore] = React.useState(0)
  const [assessedAt, setAssessedAt] = React.useState(new Date().toISOString().slice(0, 16))
  const [notes, setNotes] = React.useState('')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record ECOG performance status</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            select
            label="Score"
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            helperText="0 = fully active, 5 = dead"
          >
            <MenuItem value={0}>0 — Fully active</MenuItem>
            <MenuItem value={1}>1 — Restricted in strenuous activity</MenuItem>
            <MenuItem value={2}>2 — Ambulatory, self-care</MenuItem>
            <MenuItem value={3}>3 — Limited self-care</MenuItem>
            <MenuItem value={4}>4 — Completely disabled</MenuItem>
            <MenuItem value={5}>5 — Dead</MenuItem>
          </TextField>
          <TextField
            label="Assessed at"
            type="datetime-local"
            value={assessedAt}
            onChange={(e) => setAssessedAt(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField label="Notes" multiline rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={() =>
            onSubmit({
              patientId,
              score,
              assessedAt: new Date(assessedAt).toISOString(),
              notes: notes.trim() || undefined,
            })
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Add TNM stage group dialog ─────────────────────────────────────

const AddTnmDialog: React.FC<{
  open: boolean
  onClose: () => void
  conditionId: string
  onSubmit: (dto: {
    conditionId: string
    t?: string
    n?: string
    m?: string
    stageGroup?: string
    notes?: string
  }) => void
  saving: boolean
  error: string | null
}> = ({ open, onClose, conditionId, onSubmit, saving, error }) => {
  const [t, setT] = React.useState('')
  const [n, setN] = React.useState('')
  const [m, setM] = React.useState('')
  const [stageGroup, setStageGroup] = React.useState('')
  const [notes, setNotes] = React.useState('')

  const reset = () => {
    setT(''); setN(''); setM(''); setStageGroup(''); setNotes('')
  }

  return (
    <Dialog open={open} onClose={() => { onClose(); reset() }} maxWidth="sm" fullWidth>
      <DialogTitle>Add TNM stage group</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            AJCC 8 / UICC 8 staging. Leave any field blank if unknown.
          </Typography>
          <Stack direction="row" spacing={2}>
            <TextField label="T" placeholder="e.g. T2" value={t} onChange={(e) => setT(e.target.value)} sx={{ flex: 1 }} />
            <TextField label="N" placeholder="e.g. N1" value={n} onChange={(e) => setN(e.target.value)} sx={{ flex: 1 }} />
            <TextField label="M" placeholder="e.g. M0" value={m} onChange={(e) => setM(e.target.value)} sx={{ flex: 1 }} />
          </Stack>
          <TextField
            label="Stage group"
            placeholder="e.g. IIA"
            value={stageGroup}
            onChange={(e) => setStageGroup(e.target.value)}
          />
          <TextField label="Notes" multiline rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { onClose(); reset() }}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={() =>
            onSubmit({
              conditionId,
              t: t.trim() || undefined,
              n: n.trim() || undefined,
              m: m.trim() || undefined,
              stageGroup: stageGroup.trim() || undefined,
              notes: notes.trim() || undefined,
            })
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Add treatment plan dialog ──────────────────────────────────────

const AddTreatmentPlanDialog: React.FC<{
  open: boolean
  onClose: () => void
  conditionId: string
  onSubmit: (dto: {
    conditionId: string
    regimenName: string
    intent: 'curative' | 'palliative' | 'adjuvant' | 'neoadjuvant'
    protocolRef?: string
    startDate: string
    endDate?: string
    notes?: string
  }) => void
  saving: boolean
  error: string | null
}> = ({ open, onClose, conditionId, onSubmit, saving, error }) => {
  const [regimenName, setRegimenName] = React.useState('')
  const [intent, setIntent] = React.useState<'curative' | 'palliative' | 'adjuvant' | 'neoadjuvant'>('curative')
  const [protocolRef, setProtocolRef] = React.useState('')
  const [startDate, setStartDate] = React.useState(new Date().toISOString().split('T')[0])
  const [endDate, setEndDate] = React.useState('')
  const [notes, setNotes] = React.useState('')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add treatment plan</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Regimen name"
            placeholder="e.g. AC-T (doxorubicin + cyclophosphamide → paclitaxel)"
            value={regimenName}
            onChange={(e) => setRegimenName(e.target.value)}
            required
          />
          <TextField
            select
            label="Intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value as typeof intent)}
            required
          >
            <MenuItem value="curative">Curative</MenuItem>
            <MenuItem value="palliative">Palliative</MenuItem>
            <MenuItem value="adjuvant">Adjuvant</MenuItem>
            <MenuItem value="neoadjuvant">Neoadjuvant</MenuItem>
          </TextField>
          <TextField
            label="Protocol reference"
            placeholder="e.g. EviQ 1234 / local SOP version"
            value={protocolRef}
            onChange={(e) => setProtocolRef(e.target.value)}
          />
          <Stack direction="row" spacing={2}>
            <TextField
              label="Start date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
              required
            />
            <TextField
              label="End date (optional)"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ flex: 1 }}
            />
          </Stack>
          <TextField label="Notes" multiline rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !regimenName.trim() || !startDate}
          onClick={() =>
            onSubmit({
              conditionId,
              regimenName: regimenName.trim(),
              intent,
              protocolRef: protocolRef.trim() || undefined,
              startDate,
              endDate: endDate || undefined,
              notes: notes.trim() || undefined,
            })
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// ── Add tumour board decision dialog ───────────────────────────────

const AddDecisionDialog: React.FC<{
  open: boolean
  onClose: () => void
  conditionId: string
  onSubmit: (dto: {
    conditionId: string
    meetingDate: string
    recommendation: string
    rationale?: string
  }) => void
  saving: boolean
  error: string | null
}> = ({ open, onClose, conditionId, onSubmit, saving, error }) => {
  const [meetingDate, setMeetingDate] = React.useState(new Date().toISOString().split('T')[0])
  const [recommendation, setRecommendation] = React.useState('')
  const [rationale, setRationale] = React.useState('')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record tumour board decision</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Meeting date"
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
            required
          />
          <TextField
            label="Recommendation"
            multiline
            rows={3}
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value)}
            required
          />
          <TextField
            label="Rationale"
            multiline
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={saving || !meetingDate || !recommendation.trim()}
          onClick={() =>
            onSubmit({
              conditionId,
              meetingDate,
              recommendation: recommendation.trim(),
              rationale: rationale.trim() || undefined,
            })
          }
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default OncologyTab

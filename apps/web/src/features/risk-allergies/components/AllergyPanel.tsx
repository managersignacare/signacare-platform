// apps/web/src/features/risk-allergies/components/AllergyPanel.tsx
//
// BUG-524-A — extracted from MedicationsTab.tsx (was L2552–2681) per the
// hybrid 2-tab split plan. Carries the BUG-545 allergy-CRUD lie-about-
// success fix (3 tryAsync conversions + addError/mutationError state +
// <Alert severity="error"> UI).
//
// Imported by ActiveMedicationsTab as the prescribing-surface header
// (renders above the active sub-section toggle). NOT consumed by
// MedicationHistoryTab (read-only past context; allergies don't apply
// retrospectively).

import AddIcon from '@mui/icons-material/Add';
import ArchiveIcon from '@mui/icons-material/Archive';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, Grid, IconButton, InputLabel, MenuItem, Select, TextField, Tooltip, Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { tryAsync, isErr, type AppError, type Result } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { riskAllergiesKeys } from '../../patients/queryKeys';
import { allergyApi } from '../services/allergyApi';
import { ALLERGEN_TYPE_LABELS } from '../types/allergyTypes';
import type { AllergyResponse, AllergenType } from '../types/allergyTypes';

interface Allergy {
  id: string;
  title: string;
  reaction: string;
  severity: AllergyResponse['severity'];
  allergenType: AllergenType;
  isActive: boolean;
  createdAt: string;
}
const SEVERITY_OPTIONS = ['Mild', 'Moderate', 'Severe', 'Life-threatening'];
const SEVERITY_LABEL: Record<AllergyResponse['severity'], string> = {
  mild: 'Mild',
  moderate: 'Moderate',
  severe: 'Severe',
  life_threatening: 'Life-threatening',
  unknown: 'Unknown',
};

// BUG-545 — Allergy CRUD silent-error swallow (clinical-safety).
// Pure-function extraction of the failure-shape so unit tests can
// pin the err-arm without a render harness (BUG-525 deferred).
export type AllergyMutationOutcome = { kind: 'success' | 'failed'; message: string | null };

export function classifyAllergyMutation(r: Result<unknown, AppError>): AllergyMutationOutcome {
  return isErr(r) ? { kind: 'failed', message: r.error.message } : { kind: 'success', message: null };
}

export function buildAllergyCreatePayload(input: {
  patientId: string;
  allergen: string;
  reaction: string;
  severityLabel: string;
  allergenType: AllergenType;
}) {
  const severityMap: Record<string, AllergyResponse['severity']> = {
    'Life-threatening': 'life_threatening',
    Severe: 'severe',
    Moderate: 'moderate',
    Mild: 'mild',
  };
  return {
    patientId: input.patientId,
    allergen: input.allergen.trim(),
    allergenType: input.allergenType,
    reaction: input.reaction.trim() || undefined,
    severity: severityMap[input.severityLabel] ?? 'moderate',
    status: 'active' as const,
  };
}

interface AllergyPanelProps { patientId: string }
export function AllergyPanel({ patientId }: AllergyPanelProps) {
  const qc = useQueryClient();
  const { data: serverAllergies = [] } = useQuery<AllergyResponse[]>({
    queryKey: riskAllergiesKeys.allergies(patientId),
    queryFn: () => allergyApi.list(patientId),
    enabled: Boolean(patientId),
  });
  const allergies: Allergy[] = serverAllergies.map((a) => ({
    id: a.id,
    title: a.allergen,
    reaction: a.reaction ?? '',
    severity: a.severity,
    allergenType: a.allergenType as AllergenType,
    isActive: a.status === 'active',
    createdAt: a.createdAt,
  }));

  const [addOpen, setAddOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [title, setTitle] = useState('');
  const [reaction, setReaction] = useState('');
  const [severity, setSeverity] = useState('Moderate');
  const [allergenType, setAllergenType] = useState<AllergenType>('drug');
  const [addError, setAddError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const active = allergies.filter(a => a.isActive);
  const archived = allergies.filter(a => !a.isActive);

  const setStatus = async (id: string, status: 'inactive' | 'active', verb: 'archive' | 'restore') => {
    setMutationError(null);
    const o = classifyAllergyMutation(await tryAsync(() => apiClient.patch(`patients/${patientId}/allergies/${id}`, { status })));
    if (o.kind === 'failed') { setMutationError(o.message ?? `Failed to ${verb} allergy. Please retry.`); return; }
    qc.invalidateQueries({ queryKey: riskAllergiesKeys.allergies(patientId) });
  };

  const handleAdd = async () => {
    if (!title.trim()) return;
    setAddError(null);
    const o = classifyAllergyMutation(await tryAsync(() =>
      apiClient.post('allergies', buildAllergyCreatePayload({
        patientId,
        allergen: title,
        allergenType,
        reaction,
        severityLabel: severity,
      })),
    ));
    if (o.kind === 'failed') { setAddError(o.message ?? 'Failed to save allergy. Please retry.'); return; }
    qc.invalidateQueries({ queryKey: riskAllergiesKeys.allergies(patientId) });
    setAddOpen(false); setTitle(''); setReaction(''); setSeverity('Moderate'); setAllergenType('drug');
  };

  return (
    <Card variant="outlined" sx={{ borderColor: '#D32F2F', mb: 2 }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: active.length ? 1 : 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningAmberIcon sx={{ color: '#D32F2F', fontSize: 20 }} />
            <Typography variant="body2" fontWeight={600} color="error">Allergies</Typography>
            {active.length === 0 && <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>No known allergies</Typography>}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            {archived.length > 0 && (
              <Button size="small" onClick={() => setShowArchived(!showArchived)} sx={{ fontSize: 10, color: 'text.secondary' }}>
                {showArchived ? 'Hide' : 'Show'} Archived ({archived.length})
              </Button>
            )}
            <Button size="small" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} sx={{ fontSize: 11, color: '#D32F2F' }}>Add</Button>
          </Box>
        </Box>
        {active.map(a => (
          <Box key={a.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.3, ml: 3.5 }}>
            <Chip
              label={SEVERITY_LABEL[a.severity]}
              size="small"
              color={a.severity === 'life_threatening' || a.severity === 'severe' ? 'error' : 'warning'}
              sx={{ fontSize: 9, height: 18 }}
            />
            <Typography variant="body2" fontWeight={500}>{a.title}</Typography>
            {a.reaction && <Typography variant="caption" color="text.secondary">— {a.reaction}</Typography>}
            <Typography variant="caption" color="text.secondary">(Type: {ALLERGEN_TYPE_LABELS[a.allergenType]})</Typography>
            <Tooltip title="Archive"><IconButton size="small" aria-label="Archive allergy" onClick={() => setStatus(a.id, 'inactive', 'archive')}><ArchiveIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>
          </Box>
        ))}
        {showArchived && archived.map(a => (
          <Box key={a.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.3, ml: 3.5, opacity: 0.5 }}>
            <Chip label="Archived" size="small" sx={{ fontSize: 9, height: 18 }} />
            <Typography variant="body2" sx={{ textDecoration: 'line-through' }}>{a.title}</Typography>
            <Button size="small" onClick={() => setStatus(a.id, 'active', 'restore')} sx={{ fontSize: 10, minWidth: 0 }}>Restore</Button>
          </Box>
        ))}
        {mutationError && (
          <Alert role="alert" severity="error" onClose={() => setMutationError(null)} sx={{ ml: 3.5, mt: 0.5, fontSize: 11, py: 0 }}>
            {mutationError}
          </Alert>
        )}
      </CardContent>
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => { setAddOpen(false); setAddError(null); }} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">Add Allergy</DialogTitle>
        <DialogContent>
          {addError && (
            <Alert role="alert" severity="error" onClose={() => setAddError(null)} sx={{ mb: 1 }}>
              {addError}
            </Alert>
          )}
          <Grid container spacing={2} sx={{ mt: 0.5 }}>
            <Grid size={{ xs: 12 }}><TextField autoFocus label="Allergen / Substance *" fullWidth size="small" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Penicillin, Olanzapine" /></Grid>
            <Grid size={{ xs: 12 }}><TextField label="Reaction" fullWidth size="small" value={reaction} onChange={e => setReaction(e.target.value)} placeholder="e.g. Rash, Anaphylaxis, Nausea" /></Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small"><InputLabel>Severity</InputLabel>
                <Select value={severity} onChange={e => setSeverity(e.target.value)} label="Severity">
                  {SEVERITY_OPTIONS.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <FormControl fullWidth size="small"><InputLabel>Allergen Type</InputLabel>
                <Select value={allergenType} onChange={e => setAllergenType(e.target.value as AllergenType)} label="Allergen Type">
                  {Object.entries(ALLERGEN_TYPE_LABELS).map(([key, label]) => (
                    <MenuItem key={key} value={key}>{label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddOpen(false); setAddError(null); }}>Cancel</Button>
          <Button variant="contained" onClick={handleAdd} disabled={!title.trim()} sx={{ bgcolor: '#D32F2F', '&:hover': { bgcolor: '#B71C1C' } }}>Add Allergy</Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
}

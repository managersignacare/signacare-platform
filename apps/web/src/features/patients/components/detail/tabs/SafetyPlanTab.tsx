/**
 * Safety Plan Tab — Stanley-Brown Safety Planning Intervention
 */
import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogTitle, Divider, Grid, Paper, TextField, Typography, Checkbox, FormControlLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ShieldIcon from '@mui/icons-material/Shield';
import PhoneIcon from '@mui/icons-material/Phone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../../../../../shared/services/apiClient';
import { riskAllergiesKeys } from '../../../queryKeys';

interface SafetyPlan {
  id: string; status: string; warningSignS: string; copingStrategies: string;
  peopleForDistraction: string; peopleToContact: string; professionalsToContact: string;
  emergencyServices: string; makingEnvironmentSafe: string; reasonsForLiving: string;
  planDate: string; reviewDate: string; isSigned: boolean; createdAt: string;
}

interface SafetyPlanContent {
  warning_signs?: string;
  coping_strategies?: string;
  people_for_distraction?: string;
  people_to_contact?: string;
  professionals_to_contact?: string;
  emergency_services?: string;
  making_environment_safe?: string;
  reasons_for_living?: string;
  plan_date?: string;
  review_date?: string;
  isSigned?: boolean;
}

interface SafetyPlanRow {
  id: string;
  status?: string;
  content?: SafetyPlanContent | null;
  createdAt: string;
}

interface CreateSafetyPlanRequest {
  patientId: string;
  content: Record<string, string>;
  collaborationAttestation: {
    patientCollaborated: true;
    attestationNote: string;
  };
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const maybeResponse = error as { response?: { data?: { error?: string } }; message?: string };
    return maybeResponse.response?.data?.error ?? maybeResponse.message ?? 'Unknown';
  }
  return 'Unknown';
}

const SECTIONS = [
  { key: 'warningSign', dbKey: 'warning_signs', label: 'Step 1: Warning Signs', placeholder: 'Thoughts, images, mood, situation, behaviour that indicate a crisis is developing...' },
  { key: 'copingStrategies', dbKey: 'coping_strategies', label: 'Step 2: Internal Coping Strategies', placeholder: 'Things I can do to take my mind off my problems without contacting another person (e.g. exercise, relaxation, music)...' },
  { key: 'peopleForDistraction', dbKey: 'people_for_distraction', label: 'Step 3: People & Social Settings for Distraction', placeholder: 'People/places that provide distraction (name, phone)...' },
  { key: 'peopleToContact', dbKey: 'people_to_contact', label: 'Step 4: People I Can Ask for Help', placeholder: 'Family members or friends (name, phone)...' },
  { key: 'professionalsToContact', dbKey: 'professionals_to_contact', label: 'Step 5: Professionals & Agencies to Contact', placeholder: 'Clinician name and phone, after-hours crisis team...' },
  { key: 'makingEnvironmentSafe', dbKey: 'making_environment_safe', label: 'Step 6: Making the Environment Safe', placeholder: 'Steps to reduce access to means (e.g. remove medications, lock items away)...' },
  { key: 'reasonsForLiving', dbKey: 'reasons_for_living', label: 'My Reasons for Living', placeholder: 'What matters most to me — family, goals, pets, beliefs...' },
];

interface SafetyPlanTabProps { patientId: string }
export default function SafetyPlanTab({ patientId }: SafetyPlanTabProps) {
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({
    emergencyServices: 'Emergency: 000\nLifeline: 13 11 14\nSuicide Call Back: 1300 659 467\nCrisis Assessment Team: [local number]',
  });
  const [collaborationConfirmed, setCollaborationConfirmed] = useState(false);
  const [collaborationNote, setCollaborationNote] = useState('');

  const { data: plans, isLoading } = useQuery({
    queryKey: riskAllergiesKeys.safetyPlans(patientId),
    queryFn: async () => {
      const rows = await apiClient.get<SafetyPlanRow[]>(`safety-plans/patient/${patientId}`);
      // The API stores fields inside a `content` JSONB column — flatten them to top-level
      return (rows ?? []).map((r) => {
        const c = r.content ?? {};
        return {
          id: r.id,
          status: r.status ?? 'active',
          warningSignS: c.warning_signs ?? '',
          copingStrategies: c.coping_strategies ?? '',
          peopleForDistraction: c.people_for_distraction ?? '',
          peopleToContact: c.people_to_contact ?? '',
          professionalsToContact: c.professionals_to_contact ?? '',
          emergencyServices: c.emergency_services ?? '',
          makingEnvironmentSafe: c.making_environment_safe ?? '',
          reasonsForLiving: c.reasons_for_living ?? '',
          planDate: c.plan_date ?? r.createdAt,
          reviewDate: c.review_date ?? '',
          isSigned: c.isSigned ?? false,
          createdAt: r.createdAt,
        } as SafetyPlan;
      });
    },
    enabled: !!patientId,
  });

  const saveMut = useMutation({
    mutationFn: (data: CreateSafetyPlanRequest) => apiClient.post('safety-plans', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: riskAllergiesKeys.safetyPlans(patientId) });
      setAddOpen(false);
      setForm({ emergencyServices: form.emergencyServices });
      setCollaborationConfirmed(false);
      setCollaborationNote('');
    },
    onError: (err: unknown) => alert(`Failed to save safety plan: ${getErrorMessage(err)}`),
  });

  const activePlan = plans?.find(p => p.status === 'active');

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ShieldIcon sx={{ color: '#D32F2F' }} />
          <Typography variant="h6" fontWeight={600}>Safety Plan</Typography>
        </Box>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)}
          sx={{ bgcolor: '#D32F2F', '&:hover': { bgcolor: '#B71C1C' }, textTransform: 'none', fontSize: 12 }}>
          {activePlan ? 'New Safety Plan' : 'Create Safety Plan'}
        </Button>
      </Box>

      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" size={24} />}

      {!isLoading && !activePlan && (
        <Alert role="alert" severity="warning">No active safety plan. A safety plan should be created for all patients with identified suicide or self-harm risk.</Alert>
      )}

      {activePlan && (
        <Paper variant="outlined" sx={{ p: 3, borderLeft: '4px solid #D32F2F' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={700}>Active Safety Plan</Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Chip label={`Created: ${new Date(activePlan.planDate).toLocaleDateString('en-AU')}`} size="small" />
              {activePlan.reviewDate && <Chip label={`Review: ${new Date(activePlan.reviewDate).toLocaleDateString('en-AU')}`} size="small" color="warning" />}
              {activePlan.isSigned && <Chip label="Signed" size="small" color="success" />}
            </Box>
          </Box>

          <Grid container spacing={2}>
            {SECTIONS.map(s => {
              const val = activePlan[s.dbKey as keyof SafetyPlan] as string;
              if (!val) return null;
              return (
                <Grid key={s.key} size={{ xs: 12, md: 6 }}>
                  <Card variant="outlined" sx={{ height: '100%' }}>
                    <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="caption" fontWeight={700} color="#327C8D" sx={{ textTransform: 'uppercase', fontSize: 10 }}>
                        {s.label}
                      </Typography>
                      <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                        {val}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })}
          </Grid>

          {/* Emergency contacts always visible */}
          <Paper sx={{ mt: 2, p: 2, bgcolor: '#FFEBEE', border: '1px solid #FFCDD2' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <PhoneIcon sx={{ color: '#D32F2F', fontSize: 18 }} />
              <Typography variant="subtitle2" fontWeight={700} color="#D32F2F">Emergency Contacts</Typography>
            </Box>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
              {activePlan.emergencyServices}
            </Typography>
          </Paper>
        </Paper>
      )}

      {/* Previous plans */}
      {plans && plans.filter(p => p.status !== 'active').length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>Previous Safety Plans</Typography>
          {plans.filter(p => p.status !== 'active').map(p => (
            <Card key={p.id} variant="outlined" sx={{ mb: 1, opacity: 0.7 }}>
              <CardContent sx={{ py: 1, '&:last-child': { pb: 1 }, display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2">{new Date(p.planDate).toLocaleDateString('en-AU')}</Typography>
                <Chip label={p.status} size="small" sx={{ fontSize: 10 }} />
              </CardContent>
            </Card>
          ))}
        </Box>
      )}

      {/* Create Safety Plan Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title" sx={{ fontWeight: 700, color: '#D32F2F' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShieldIcon />
            Stanley-Brown Safety Plan
          </Box>
        </DialogTitle>
        <Divider />
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Complete each step collaboratively with the patient. The safety plan should be reviewed regularly.
          </Typography>
          {SECTIONS.map(s => (
            <TextField key={s.key} label={s.label} fullWidth multiline rows={2} size="small"
              placeholder={s.placeholder} value={form[s.key] ?? ''} onChange={e => setForm(p => ({ ...p, [s.key]: e.target.value }))}
              sx={{ mb: 2 }} />
          ))}
          <TextField label="Emergency Services" fullWidth multiline rows={3} size="small"
            value={form.emergencyServices ?? ''} onChange={e => setForm(p => ({ ...p, emergencyServices: e.target.value }))}
            sx={{ mb: 2 }} />
          <TextField label="Review Date" type="date" size="small" value={form.reviewDate ?? ''} onChange={e => setForm(p => ({ ...p, reviewDate: e.target.value }))}
            slotProps={{ inputLabel: { shrink: true } }} />
          <Box sx={{ mt: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={collaborationConfirmed}
                  onChange={(_, checked) => setCollaborationConfirmed(checked)}
                />
              }
              label="I confirm this safety plan was completed collaboratively with the patient."
            />
            <TextField
              label="Collaboration attestation note"
              fullWidth
              multiline
              rows={2}
              size="small"
              value={collaborationNote}
              onChange={(e) => setCollaborationNote(e.target.value)}
              placeholder="Document the collaboration context (e.g., reviewed with patient and agreed actions)."
              sx={{ mt: 1 }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setAddOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => {
              const camelToSnake: Record<string, string> = {
                warningSign: 'warning_signs',
                copingStrategies: 'coping_strategies',
                peopleForDistraction: 'people_for_distraction',
                peopleToContact: 'people_to_contact',
                professionalsToContact: 'professionals_to_contact',
                makingEnvironmentSafe: 'making_environment_safe',
                reasonsForLiving: 'reasons_for_living',
                emergencyServices: 'emergency_services',
                reviewDate: 'review_date',
              };
              const content: Record<string, string> = {};
              for (const [key, value] of Object.entries(form)) {
                const snakeKey = camelToSnake[key] ?? key;
                if (value) content[snakeKey] = value;
              }
              saveMut.mutate({
                patientId,
                content,
                collaborationAttestation: {
                  patientCollaborated: true,
                  attestationNote: collaborationNote.trim(),
                },
              });
            }}
            disabled={saveMut.isPending || !collaborationConfirmed || collaborationNote.trim().length < 10}
            sx={{ bgcolor: '#D32F2F', '&:hover': { bgcolor: '#B71C1C' } }}>
            {saveMut.isPending ? 'Saving...' : 'Save Safety Plan'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

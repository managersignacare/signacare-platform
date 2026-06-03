// apps/web/src/features/medications/components/SideEffectsPanel.tsx
//
// BUG-524-F — extracted from MedicationsTab.tsx (was L366-416) per the
// hybrid 2-tab split plan. Side-effects monitoring schedules display
// (AIMS / metabolic / extrapyramidal / etc.). Read-only display of
// monitoring schedule status. Imported by ActiveMedicationsTab as the
// Side Effects sub-section per locked design 2026-04-29.

import { Alert, Box, Chip, CircularProgress, Paper, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { tryAsync, isErr, type SideEffectScheduleResponse } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { inpatientKeys } from '../../patients/queryKeys';

// ── Side Effects Monitoring Panel ────────────────────────────────────────────
interface SideEffectsPanelProps { patientId: string }
export function SideEffectsPanel({ patientId }: SideEffectsPanelProps) {
  // BUG-611 closes the silent-catch lie-about-success class on this
  // clinical-safety surface (sibling of BUG-441/445/548/608). The
  // pre-fix queryFn caught the rejection and returned an empty-data
  // envelope, collapsing fetch failure into "No side-effect monitoring
  // schedules configured" — a clinician on a clozapine patient after a
  // network blip would not know to follow up on overdue AIMS / lipids /
  // glucose / FBC. Per BUG-530 SSoT (CLAUDE.md §16.2), use tryAsync to
  // surface failure explicitly via React-Query's isError state and
  // render a failure banner with explicit clinical-safety guidance.
  //
  // BUG-613 — backend now returns canonical camelCase per CLAUDE.md
  // §5.2. Consumer reads only the canonical SideEffectScheduleResponse
  // shape (no `?? snake_case` fallbacks). Pre-fix the camelCase reads
  // for `nextDueDate` / `lastCompletedDate` always returned undefined
  // (backend leaked snake_case), so the OVERDUE indicator never fired
  // and the "Last: ..." line never rendered. Post-fix both work.
  const { data, isLoading, isError } = useQuery({
    queryKey: inpatientKeys.sideEffectSchedules(patientId),
    queryFn: async () => {
      const r = await tryAsync(() => apiClient.get<{ data: SideEffectScheduleResponse[] } | SideEffectScheduleResponse[]>('side-effect-schedules', { patientId }));
      if (isErr(r)) throw r.error;
      return r.value;
    },
    enabled: !!patientId,
  });
  const schedules: SideEffectScheduleResponse[] = Array.isArray(data) ? data : (data?.data ?? []);

  if (isLoading) return <Box sx={{ py: 4, textAlign: 'center' }}><CircularProgress role="progressbar" aria-label="Loading" size={24} /></Box>;
  if (isError) return (
    <Alert role="alert" severity="error" sx={{ mt: 1 }}>
      Failed to load side-effect monitoring schedules. The display may be stale or empty — refresh to retry. Do not assume AIMS, metabolic, or other monitoring is current while the error persists.
    </Alert>
  );
  if (schedules.length === 0) return (
    <Box sx={{ py: 4, textAlign: 'center' }}>
      <Typography variant="body2" color="text.secondary">No side-effect monitoring schedules configured.</Typography>
      <Typography variant="caption" color="text.secondary">Schedules can be created for AIMS, metabolic monitoring, etc.</Typography>
    </Box>
  );

  return (
    <Box>
      {schedules.map((s, i) => {
        const isOverdue = s.nextDueDate != null && new Date(s.nextDueDate) < new Date();
        return (
          <Paper key={s.id ?? i} variant="outlined" sx={{ p: 2, mb: 1.5, borderLeft: `3px solid ${isOverdue ? '#D32F2F' : '#327C8D'}` }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Box>
                <Typography variant="body2" fontWeight={700} sx={{ textTransform: 'capitalize' }}>{s.scheduleType ?? 'Monitoring'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  Every {s.frequencyWeeks ?? '?'} weeks | Status: {s.status ?? 'active'}
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                <Chip
                  label={isOverdue ? 'OVERDUE' : `Due: ${s.nextDueDate ? new Date(s.nextDueDate).toLocaleDateString('en-AU') : '—'}`}
                  size="small"
                  sx={{ bgcolor: isOverdue ? '#FDECEA' : '#E8F5E9', color: isOverdue ? '#D32F2F' : '#2E7D32', fontSize: 10, fontWeight: 600 }}
                />
                {s.lastCompletedDate && (
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ fontSize: 10, mt: 0.5 }}>
                    Last: {new Date(s.lastCompletedDate).toLocaleDateString('en-AU')}
                  </Typography>
                )}
              </Box>
            </Box>
          </Paper>
        );
      })}
    </Box>
  );
}

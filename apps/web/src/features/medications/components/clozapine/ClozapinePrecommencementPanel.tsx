// apps/web/src/features/medications/components/clozapine/ClozapinePrecommencementPanel.tsx
//
// BUG-607 — extracted from ClozapinePanel.tsx (was L848-871; ~24 LOC)
// per the inner-tab structural split. Read-only display of the
// 10-item NIMC pre-commencement checklist + the post-interruption
// blood-monitoring restart rules. Zero coupling — no data fetched,
// no mutations, no state. Just renders the constant.
//
// Imported by ClozapinePanel as the Pre-commencement sub-section.

import { Box, Paper, Typography } from '@mui/material';
import { PRE_COMMENCEMENT_ITEMS } from './clozapineConstants';

export function ClozapinePrecommencementPanel() {
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>Pre-commencement Checklist</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Complete all items before commencing clozapine titration. All patients, prescribers, pharmacists, and clozapine coordinators must be registered with the Clozapine Monitoring Centre.
      </Typography>
      <Paper variant="outlined" sx={{ p: 2 }}>
        {PRE_COMMENCEMENT_ITEMS.map((item, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, py: 0.8, borderBottom: i < PRE_COMMENCEMENT_ITEMS.length - 1 ? '1px solid #E0E0E0' : 'none' }}>
            <Box sx={{ width: 18, height: 18, border: '2px solid #9E9E9E', borderRadius: 1, flexShrink: 0, mt: 0.2 }} />
            <Typography variant="body2" sx={{ fontSize: 12 }}>{i + 1}. {item}</Typography>
          </Box>
        ))}
      </Paper>

      {/* Blood monitoring restart rules */}
      <Paper variant="outlined" sx={{ p: 2, mt: 2, borderLeft: '4px solid #C62828' }}>
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: '#C62828' }}>Blood Monitoring After Interruption</Typography>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}><strong>Dose missed ≤ 72 hours:</strong> Continue monitoring as normal.</Typography>
        <Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}><strong>Dose missed 72 hours – 4 weeks:</strong> Monitor weekly for at least 6 weeks (to achieve total of 18 weeks monitoring).</Typography>
        <Typography variant="caption" sx={{ display: 'block' }}><strong>Dose missed ≥ 4 weeks:</strong> Monitoring should recommence as for a new consumer.</Typography>
      </Paper>
    </Box>
  );
}

import React from 'react';
import { Accordion, AccordionDetails, AccordionSummary, Box, Paper, Typography } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { fmtDate } from './summaryTabDomain';
import type { SummaryArtifactVersion } from './summaryArtifacts';

export function renderArtifactHistoryCard(title: string, versions: SummaryArtifactVersion[]): React.ReactElement | null {
  const rows = versions.filter((row) => row.content.trim().length > 0);
  if (rows.length === 0) return null;
  return (
    <Accordion sx={{ mt: 1.5 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails sx={{ pt: 0 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {rows.map((version, index) => (
            <Paper key={version.id} variant="outlined" sx={{ p: 1.5, bgcolor: '#FAFAFA' }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.6 }}>
                Version {rows.length - index} · {fmtDate(version.createdAt)}
              </Typography>
              <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11, color: '#3D484B', maxHeight: 160, overflowY: 'auto' }}>
                {version.content}
              </Box>
            </Paper>
          ))}
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

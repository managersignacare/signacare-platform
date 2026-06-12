/**
 * Phase 8 UI refactor — diagnostic log panel extracted from
 * AmbientAiRecorder.
 *
 * Pure presentational component. Renders the collapsible diagnostic
 * log with the original colour-coding rules (error / warning / success
 * / default) preserved verbatim. The hide/show toggle is delegated
 * through a callback prop.
 */
import { Box, Button, Paper, Typography } from '@mui/material';

interface AmbientDiagnosticsPanelProps {
  diagLog: readonly string[];
  showDiag: boolean;
  onToggle: () => void;
}

function colourFor(line: string): string {
  if (line.includes('ERROR')) return '#FF6B6B';
  if (line.includes('WARNING')) return '#FFD93D';
  if (line.includes('complete') || line.includes('ready')) return '#6BCB77';
  return '#B0BEC5';
}

export function AmbientDiagnosticsPanel({ diagLog, showDiag, onToggle }: AmbientDiagnosticsPanelProps) {
  if (diagLog.length === 0) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <Button
        size="small"
        onClick={onToggle}
        sx={{ fontSize: 10, textTransform: 'none', color: 'text.secondary', p: 0.5 }}
      >
        {showDiag ? 'Hide' : 'Show'} diagnostic log ({diagLog.length} entries)
      </Button>
      {showDiag && (
        <Paper variant="outlined" sx={{ mt: 0.5, p: 1, maxHeight: 200, overflow: 'auto', bgcolor: '#1E1E1E', borderRadius: 1 }}>
          {diagLog.map((line, i) => (
            <Typography
              key={i}
              variant="caption"
              display="block"
              sx={{ fontFamily: 'monospace', fontSize: 10, lineHeight: 1.6, color: colourFor(line) }}
            >
              {line}
            </Typography>
          ))}
        </Paper>
      )}
    </Box>
  );
}

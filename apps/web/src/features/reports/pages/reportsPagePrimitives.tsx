import type { ReactElement, ReactNode } from 'react';
import { Box, Card, CardContent, CircularProgress, Typography } from '@mui/material';

export function ReportTabLoading({ label }: { label: string }): ReactElement {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 1.5, py: 6 }}>
      <CircularProgress role="progressbar" aria-label="Loading" size={20} sx={{ color: '#b8621a' }} />
      <Typography variant="body2" color="text.secondary">{label}</Typography>
    </Box>
  );
}

interface StatCardProps {
  icon: ReactNode;
  color: string;
  label: string;
  value: string | number;
  sub?: string;
}

export function StatCard({ icon, color, label, value, sub }: StatCardProps): ReactElement {
  return (
    <Card elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 }, display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ width: 44, height: 44, borderRadius: 2, bgcolor: `${color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>{icon}</Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h5" fontWeight={800} sx={{ color, lineHeight: 1 }}>{value}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>{label}</Typography>
          {sub && <Typography variant="caption" display="block" sx={{ fontSize: '0.6rem', color: '#D32F2F', fontWeight: 600 }}>{sub}</Typography>}
        </Box>
      </CardContent>
    </Card>
  );
}

interface BarRowProps {
  label: string;
  value: number;
  max: number;
  color: string;
}

export function BarRow({ label, value, max, color }: BarRowProps): ReactElement {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
      <Typography variant="body2" sx={{ width: 160, fontSize: 12 }}>{label}</Typography>
      <Box sx={{ flex: 1, bgcolor: '#E0E0E0', borderRadius: 1, height: 16 }}>
        <Box sx={{ width: `${pct}%`, bgcolor: color, borderRadius: 1, height: 16, minWidth: pct > 0 ? 8 : 0 }} />
      </Box>
      <Typography variant="caption" fontWeight={600} sx={{ minWidth: 24, textAlign: 'right' }}>{value}</Typography>
    </Box>
  );
}

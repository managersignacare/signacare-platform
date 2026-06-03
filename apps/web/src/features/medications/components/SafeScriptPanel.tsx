/**
 * SafeScript Notification Panel
 *
 * Matches the official SafeScript Red / Amber / Green traffic-light notification
 * pattern per the Victorian DHHS SafeScript Notification App specification.
 *
 * RED    — Clinical alert(s) exist. Requires immediate review.
 * AMBER  — Records for monitored medicines exist. Requires review.
 * GREEN  — No recent history, or single prescriber with no alerts.
 */
import { Box, Chip, CircularProgress, Typography } from '@mui/material';
import ErrorIcon from '@mui/icons-material/Error';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import type { PrescriptionResponse, SafeScriptCheckResult } from '@signacare/shared';

type NotificationLevel = 'red' | 'amber' | 'green' | 'unchecked';

function deriveLevel(result: SafeScriptCheckResult | null): NotificationLevel {
  if (!result?.checked) return 'unchecked';
  if (result.riskIndicators.length > 0) return 'red';
  if (result.patientFound && result.supplies.length > 0) return 'amber';
  return 'green';
}

const LEVEL_CONFIG: Record<NotificationLevel, {
  bgColor: string; borderColor: string; chipColor: string; chipLabel: string;
  icon: React.ReactNode; title: string; description: string;
}> = {
  red: {
    bgColor: '#FFF0F0', borderColor: '#D32F2F', chipColor: '#D32F2F',
    chipLabel: 'Alert — Review Required',
    icon: <ErrorIcon sx={{ color: '#D32F2F', fontSize: 22 }} />,
    title: 'Clinical Alert(s) Exist',
    description: 'Please check SafeScript. Clinical alert(s) exist for this patient.',
  },
  amber: {
    bgColor: '#FFF8F0', borderColor: '#F0852C', chipColor: '#F0852C',
    chipLabel: 'Records Exist — Review',
    icon: <WarningAmberIcon sx={{ color: '#F0852C', fontSize: 22 }} />,
    title: 'Monitored Medicine Records Exist',
    description: 'Records for monitored medicines exist in SafeScript. Please review before prescribing.',
  },
  green: {
    bgColor: '#F0FAF6', borderColor: '#4E9C82', chipColor: '#4E9C82',
    chipLabel: 'Clear',
    icon: <CheckCircleIcon sx={{ color: '#4E9C82', fontSize: 22 }} />,
    title: 'No Alerts',
    description: 'No recent history of monitored medicines, or single prescriber with no alerts.',
  },
  unchecked: {
    bgColor: '#F5F5F5', borderColor: '#9E9E9E', chipColor: '#9E9E9E',
    chipLabel: 'Not Checked',
    icon: <InfoOutlinedIcon sx={{ color: '#9E9E9E', fontSize: 22 }} />,
    title: 'SafeScript Check Required',
    description: 'Run a SafeScript check before prescribing this Schedule 8 medication.',
  },
};

interface Props {
  prescription: PrescriptionResponse | null;
}

export default function SafeScriptPanel({ prescription }: Props) {
  if (!prescription) return null;

  // If not S8, no SafeScript check is required
  if (!prescription.isS8 && !prescription.safescriptChecked) return null;

  if (!prescription.safescriptChecked) {
    const cfg = LEVEL_CONFIG.unchecked;
    return (
      <Box sx={{ border: `2px solid ${cfg.borderColor}`, borderRadius: 2, p: 2, mb: 2, bgcolor: cfg.bgColor }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: cfg.borderColor }} />
          <Typography variant="subtitle2" fontWeight={600} fontFamily="Albert Sans, sans-serif">{cfg.title}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mt: 0.5 }}>
          {cfg.description}
        </Typography>
      </Box>
    );
  }

  const result = prescription.safescriptResult;
  const level = deriveLevel(result);
  const cfg = LEVEL_CONFIG[level];

  return (
    <Box
      sx={{
        border: `2px solid ${cfg.borderColor}`,
        borderLeft: `6px solid ${cfg.borderColor}`,
        borderRadius: 2,
        p: 2,
        mb: 2,
        bgcolor: cfg.bgColor,
      }}
    >
      {/* Header row — icon, title, chip, timestamp */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        {cfg.icon}
        <Typography variant="subtitle2" fontWeight={700} fontFamily="Albert Sans, sans-serif">
          {cfg.title}
        </Typography>
        <Chip
          size="small"
          label={cfg.chipLabel}
          sx={{ bgcolor: cfg.chipColor, color: '#fff', fontSize: 11, fontWeight: 600, fontFamily: 'Albert Sans, sans-serif' }}
        />
        {prescription.safescriptCheckedAt && (
          <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ ml: 'auto' }}>
            {new Date(prescription.safescriptCheckedAt).toLocaleString('en-AU', {
              day: '2-digit', month: '2-digit', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            })}
          </Typography>
        )}
      </Box>

      <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mb: 1 }}>
        {cfg.description}
      </Typography>

      {/* Risk indicators (RED level) */}
      {result && result.riskIndicators.length > 0 && (
        <Box sx={{ bgcolor: '#FFEBEE', borderRadius: 1, p: 1.5, mb: 1 }}>
          <Typography variant="caption" fontWeight={700} color="#D32F2F" fontFamily="Albert Sans, sans-serif">
            Clinical Alert(s):
          </Typography>
          {result.riskIndicators.map((ri, i) => (
            <Typography key={i} variant="body2" fontFamily="Albert Sans, sans-serif" sx={{ color: '#B71C1C', pl: 1.5 }}>
              ⚠ {ri}
            </Typography>
          ))}
        </Box>
      )}

      {/* Supply history (AMBER / RED level) */}
      {result && result.supplies.length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" fontWeight={700} fontFamily="Albert Sans, sans-serif">
            Recent Monitored Supplies ({result.supplies.length}):
          </Typography>
          <Box component="table" sx={{ width: '100%', mt: 0.5, fontSize: 12, fontFamily: 'Albert Sans, sans-serif', '& td': { py: 0.3, pr: 1.5 } }}>
            <thead>
              <tr>
                <Box component="td" sx={{ fontWeight: 600, color: 'text.secondary' }}>Medication</Box>
                <Box component="td" sx={{ fontWeight: 600, color: 'text.secondary' }}>Pharmacy</Box>
                <Box component="td" sx={{ fontWeight: 600, color: 'text.secondary' }}>Date</Box>
                <Box component="td" sx={{ fontWeight: 600, color: 'text.secondary' }}>Prescriber</Box>
              </tr>
            </thead>
            <tbody>
              {result.supplies.slice(0, 10).map((s, i) => (
                <tr key={i}>
                  <td>{s.medicationName}{s.dose ? ` ${s.dose}` : ''}</td>
                  <td>{s.dispensingPharmacy}</td>
                  <td>{s.supplyDate}</td>
                  <td>{s.prescribedBy ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Box>
          {result.supplies.length > 10 && (
            <Typography variant="caption" color="text.secondary" fontFamily="Albert Sans, sans-serif">
              + {result.supplies.length - 10} more supplies
            </Typography>
          )}
        </Box>
      )}

      {/* Patient not found */}
      {result && !result.patientFound && (
        <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif" sx={{ mt: 0.5 }}>
          Patient not found in SafeScript registry — no monitored medicine history on record.
        </Typography>
      )}
    </Box>
  );
}

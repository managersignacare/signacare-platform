import { Alert, Box, Chip, Tooltip, Typography } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ShieldIcon from '@mui/icons-material/Shield';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import type { AmbientNoteResult, SafetyAlert, VerifiedMedication } from '../../../../shared/types/llmTypes';

interface StatusDotProps {
  ok: boolean | null;
  label: string;
}

export function StatusDot({ ok, label }: StatusDotProps) {
  const color = ok === true ? '#4CAF50' : ok === false ? '#F44336' : '#9E9E9E';
  const title = ok === true ? `${label}: Connected` : ok === false ? `${label}: Not available` : `${label}: Checking...`;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4 }} title={title}>
      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>{label}</Typography>
    </Box>
  );
}

interface ConfidenceBadgeProps {
  confidence: number;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const color = confidence > 70 ? '#4CAF50' : confidence > 40 ? '#b8621a' : '#D32F2F';
  const label = confidence > 70 ? 'HIGH' : confidence > 40 ? 'MODERATE' : 'LOW';
  return (
    <Chip
      size="small"
      label={`${confidence}% ${label}`}
      sx={{ fontSize: 9, height: 20, bgcolor: `${color}15`, color, fontWeight: 700, fontFamily: 'monospace' }}
    />
  );
}

interface QUESTGradeBadgeProps {
  grade: string;
  score: number;
}

export function QUESTGradeBadge({ grade, score }: QUESTGradeBadgeProps) {
  const colors: Record<string, { bg: string; fg: string }> = {
    A: { bg: '#E8F5E9', fg: '#2E7D32' },
    B: { bg: '#E3F2FD', fg: '#1565C0' },
    C: { bg: '#FFF3E0', fg: '#E65100' },
    D: { bg: '#FFF8E1', fg: '#F57F17' },
    F: { bg: '#FFEBEE', fg: '#D32F2F' },
  };
  const selected = colors[grade] ?? colors.C;
  return (
    <Tooltip title={`QUEST Quality Score: ${score}/100. Grade ${grade}. Measures completeness, accuracy, safety, clarity, and actionability.`}>
      <Chip
        size="small"
        label={`QUEST: ${grade} (${score})`}
        sx={{ fontSize: 9, height: 20, bgcolor: selected.bg, color: selected.fg, fontWeight: 700, fontFamily: 'monospace' }}
      />
    </Tooltip>
  );
}

interface RiskLevelChipProps {
  level: string;
}

export function RiskLevelChip({ level }: RiskLevelChipProps) {
  const colors: Record<string, { bg: string; fg: string }> = {
    critical: { bg: '#FFEBEE', fg: '#D32F2F' },
    high: { bg: '#FFF3E0', fg: '#E65100' },
    medium: { bg: '#FFF8E1', fg: '#F57F17' },
    low: { bg: '#E8F5E9', fg: '#2E7D32' },
  };
  const selected = colors[level] ?? colors.medium;
  return (
    <Chip label={level.toUpperCase()} size="small" sx={{ fontSize: 9, height: 18, bgcolor: selected.bg, color: selected.fg, fontWeight: 700 }} />
  );
}

interface SafetyAlertsBannerProps {
  alerts: SafetyAlert[];
}

export function SafetyAlertsBanner({ alerts }: SafetyAlertsBannerProps) {
  const critical = alerts.filter((alert) => alert.severity === 'critical');
  const warnings = alerts.filter((alert) => alert.severity === 'warning');
  const info = alerts.filter((alert) => alert.severity === 'info');

  return (
    <Box sx={{ mb: 1.5 }}>
      {critical.length > 0 && (
        <Alert role="alert" severity="error" sx={{ mb: 0.5, fontSize: 12, py: 0.5 }} icon={<ErrorIcon sx={{ fontSize: 16 }} />}>
          <Typography variant="caption" fontWeight={700} display="block">Critical Safety Alerts:</Typography>
          {critical.map((alert, index) => (
            <Typography key={index} variant="caption" display="block" sx={{ fontSize: 11 }}>
              {alert.message}
            </Typography>
          ))}
        </Alert>
      )}
      {warnings.length > 0 && (
        <Alert role="alert" severity="warning" sx={{ mb: 0.5, fontSize: 12, py: 0.5 }} icon={<WarningAmberIcon sx={{ fontSize: 16 }} />}>
          <Typography variant="caption" fontWeight={700} display="block">Safety Warnings:</Typography>
          {warnings.map((alert, index) => (
            <Typography key={index} variant="caption" display="block" sx={{ fontSize: 11 }}>
              {alert.message}
            </Typography>
          ))}
        </Alert>
      )}
      {info.length > 0 && (
        <Alert severity="info" sx={{ mb: 0.5, fontSize: 12, py: 0.5 }} icon={<ShieldIcon sx={{ fontSize: 16 }} />}>
          <Typography variant="caption" fontWeight={700} display="block">Monitoring Reminders:</Typography>
          {info.map((alert, index) => (
            <Typography key={index} variant="caption" display="block" sx={{ fontSize: 11 }}>
              {alert.message}
            </Typography>
          ))}
        </Alert>
      )}
    </Box>
  );
}

interface RiskBannerProps {
  riskAssessment: NonNullable<AmbientNoteResult['riskAssessment']>;
}

export function RiskBanner({ riskAssessment }: RiskBannerProps) {
  const severity = riskAssessment.overallLevel === 'critical' || riskAssessment.overallLevel === 'high' ? 'error' : 'warning';
  return (
    <Alert severity={severity} sx={{ mb: 1.5, fontSize: 12 }} icon={<ShieldIcon />}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <Typography variant="caption" fontWeight={700}>Risk Level: </Typography>
        <RiskLevelChip level={riskAssessment.overallLevel} />
      </Box>
      {riskAssessment.flags.slice(0, 3).map((flag, index) => (
        <Typography key={index} variant="caption" display="block" sx={{ fontSize: 11 }}>
          {flag.flag} — {flag.action}
        </Typography>
      ))}
    </Alert>
  );
}

interface VerifiedMedRowProps {
  med: VerifiedMedication;
}

export function VerifiedMedRow({ med }: VerifiedMedRowProps) {
  const changeColors: Record<string, string> = {
    started: '#2E7D32',
    increased: '#1565C0',
    decreased: '#b8621a',
    ceased: '#D32F2F',
    continued: '#327C8D',
    mentioned: '#999',
  };
  const change = med.change ?? 'mentioned';
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, borderBottom: '1px solid #f0ebe4', flexWrap: 'wrap' }}>
      <Chip
        label={change}
        size="small"
        sx={{ fontSize: 9, height: 18, bgcolor: `${changeColors[change]}15`, color: changeColors[change], fontWeight: 700 }}
      />
      <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>{med.name}</Typography>
      {med.dose && <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>{med.dose}</Typography>}
      {med.frequency && <Typography variant="body2" sx={{ fontSize: 12, color: 'text.secondary' }}>{med.frequency}</Typography>}

      {med.doseInRange === true && (
        <Tooltip title="Dose within standard range">
          <CheckCircleIcon sx={{ fontSize: 14, color: '#4CAF50' }} />
        </Tooltip>
      )}
      {med.doseInRange === false && (
        <Tooltip title="Dose outside standard range — verify">
          <ErrorIcon sx={{ fontSize: 14, color: '#D32F2F' }} />
        </Tooltip>
      )}
      {med.isS8 && (
        <Chip label="S8" size="small" sx={{ fontSize: 8, height: 16, bgcolor: '#FFEBEE', color: '#D32F2F', fontWeight: 700 }} />
      )}
      {med.monitoringRequired && (
        <Typography variant="caption" sx={{ fontSize: 10, color: '#1565C0' }}>
          Monitor: {med.monitoringRequired}
        </Typography>
      )}
    </Box>
  );
}

export function buildNoteText(result: AmbientNoteResult): string {
  const parts: string[] = [];

  if (result.structured.subjective) parts.push(`SUBJECTIVE:\n${result.structured.subjective}`);
  if (result.structured.objective) parts.push(`OBJECTIVE:\n${result.structured.objective}`);
  if (result.structured.assessment) parts.push(`ASSESSMENT:\n${result.structured.assessment}`);
  if (result.structured.plan) parts.push(`PLAN:\n${result.structured.plan}`);

  if (result.mentalStateExam) {
    const mse = result.mentalStateExam;
    const mseLines = [
      `Appearance: ${mse.appearance || 'Not assessed'}`,
      `Behaviour: ${mse.behaviour || 'Not assessed'}`,
      `Speech: ${mse.speech || 'Not assessed'}`,
      `Mood: ${mse.mood || 'Not assessed'}`,
      `Affect: ${mse.affect || 'Not assessed'}`,
      `Thought Form: ${mse.thoughtForm || 'Not assessed'}`,
      `Thought Content: ${mse.thoughtContent || 'Not assessed'}`,
      `Perception: ${mse.perception || 'Not assessed'}`,
      `Cognition: ${mse.cognition || 'Not assessed'}`,
      `Insight: ${mse.insight || 'Not assessed'}`,
      `Judgement: ${mse.judgement || 'Not assessed'}`,
    ];
    parts.push(`MENTAL STATE EXAMINATION:\n${mseLines.join('\n')}`);
  }

  const meds = result.verifiedMedications ?? result.medications;
  if (meds && meds.length > 0) {
    const medLines = meds.map((medication) => {
      const detail = [medication.dose, medication.frequency].filter(Boolean).join(' ');
      let line = `- ${medication.name}${detail ? ` ${detail}` : ''}${medication.change && medication.change !== 'mentioned' ? ` (${medication.change})` : ''}`;
      if ('doseInRange' in medication && medication.doseInRange === false) line += ' [DOSE OUT OF RANGE - VERIFY]';
      if ('isS8' in medication && medication.isS8) line += ' [S8]';
      if ('monitoringRequired' in medication && medication.monitoringRequired) line += ` [Monitor: ${medication.monitoringRequired}]`;
      return line;
    });
    parts.push(`MEDICATIONS:\n${medLines.join('\n')}`);
  }

  if (result.riskAssessment) {
    const risk = result.riskAssessment;
    const riskLines = [`Overall level: ${risk.overallLevel.toUpperCase()}`];
    risk.flags.forEach((flag) => riskLines.push(`- [${flag.severity}] ${flag.flag}: ${flag.evidence}`));
    if (risk.protectiveFactors.length > 0) riskLines.push(`Protective factors: ${risk.protectiveFactors.join(', ')}`);
    parts.push(`RISK ASSESSMENT:\n${riskLines.join('\n')}`);
  } else if (result.riskFlags.length) {
    parts.push(`RISK FLAGS:\n${result.riskFlags.map((flag) => `- ${flag}`).join('\n')}`);
  }

  if (result.safetyAlerts && result.safetyAlerts.length > 0) {
    parts.push(`SAFETY ALERTS:\n${result.safetyAlerts.map((alert) => `- [${alert.severity.toUpperCase()}] ${alert.message}`).join('\n')}`);
  }

  if (result.suggestedDiagnosis.length) {
    parts.push(`PROVISIONAL DIAGNOSIS:\n${result.suggestedDiagnosis.join(', ')}`);
  }

  if (result.quality) {
    parts.push(
      `\n--- AI Documentation Quality: ${result.quality.overallConfidence}% confidence | ` +
        `${result.quality.sectionsWithEvidence}/${result.quality.sectionsTotal} sections with evidence | ` +
        `${result.quality.transcriptWordCount} transcript words ---`,
    );
  }

  return parts.join('\n\n');
}

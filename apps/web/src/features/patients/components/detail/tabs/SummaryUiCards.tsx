import React from 'react';
import { Box, Card, CardContent, Chip, Typography } from '@mui/material';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import type { PhysicalHealthSummary } from './summaryTabDomain';

interface QuickCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}

export function QuickCard({ icon, label, value, sub }: QuickCardProps) {
  return (
    <Card variant="outlined" sx={{ bgcolor: '#FBF8F5', height: '100%' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
        {icon}
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.3, fontSize: '0.65rem' }}>{label}</Typography>
        <Typography variant="body2" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', maxWidth: '100%' }} title={typeof value === 'string' ? value : undefined}>{value}</Typography>
        {sub && <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>{sub}</Typography>}
      </CardContent>
    </Card>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  color: string;
}

export function StatCard({ icon, label, value, sub, color }: StatCardProps) {
  return (
    <Card variant="outlined" sx={{ bgcolor: color, height: '100%' }}>
      <CardContent sx={{ py: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          {icon}
          <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif">{value}</Typography>
        </Box>
        <Typography variant="caption" fontWeight={600} display="block" fontFamily="Albert Sans, sans-serif">{label}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{sub}</Typography>
      </CardContent>
    </Card>
  );
}

function getBmiCategory(bmi: number): { label: string; color: string } {
  if (bmi < 18.5) return { label: 'Underweight', color: '#0288D1' };
  if (bmi < 25) return { label: 'Normal', color: '#2E7D32' };
  if (bmi < 30) return { label: 'Overweight', color: '#E65100' };
  return { label: 'Obese', color: '#D32F2F' };
}

interface BmiCardProps {
  physicalHealth: PhysicalHealthSummary | null | undefined;
}

export function BmiCard({ physicalHealth }: BmiCardProps) {
  const bmi = physicalHealth?.bmi ? Number(physicalHealth.bmi) : null;
  const bmiCat = bmi ? getBmiCategory(bmi) : null;
  return (
    <Card variant="outlined" sx={{ bgcolor: '#FBF8F5', height: '100%' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
        <FitnessCenterIcon sx={{ color: '#b8621a', fontSize: 22 }} />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.3, fontSize: '0.65rem' }}>Weight / BMI</Typography>
        <Typography variant="body2" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ lineHeight: 1.3 }}>
          {physicalHealth?.weight ? `${physicalHealth.weight} kg` : '— kg'}
        </Typography>
        {bmi ? (
          <Chip
            label={`BMI: ${bmi.toFixed(1)} — ${bmiCat!.label}`}
            size="small"
            sx={{ mt: 0.25, fontSize: '0.6rem', height: 18, bgcolor: bmiCat!.color + '18', color: bmiCat!.color, fontWeight: 700 }}
          />
        ) : (
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>BMI: —</Typography>
        )}
      </CardContent>
    </Card>
  );
}

interface PhysicalHealthCardProps {
  physicalHealth: PhysicalHealthSummary | null | undefined;
}

export function PhysicalHealthCard({ physicalHealth }: PhysicalHealthCardProps) {
  const bp = physicalHealth?.systolicBp && physicalHealth?.diastolicBp
    ? `${physicalHealth.systolicBp}/${physicalHealth.diastolicBp}`
    : (physicalHealth?.bloodPressure ?? null);
  const hr = physicalHealth?.heartRate ?? physicalHealth?.pulse ?? null;
  const recordedAt = physicalHealth?.assessmentDate ?? physicalHealth?.createdAt;

  return (
    <Card variant="outlined" sx={{ bgcolor: '#FBF8F5', height: '100%' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 }, textAlign: 'center' }}>
        <MonitorHeartIcon sx={{ color: '#D32F2F', fontSize: 22 }} />
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.3, fontSize: '0.65rem' }}>Physical Health</Typography>
        {physicalHealth ? (
          <>
            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1.5, mt: 0.25 }}>
              {bp && (
                <Box>
                  <Typography variant="body2" fontWeight={700} sx={{ fontSize: 12, color: '#D32F2F', lineHeight: 1.2 }}>{bp}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem' }}>BP mmHg</Typography>
                </Box>
              )}
              {hr && (
                <Box>
                  <Typography variant="body2" fontWeight={700} sx={{ fontSize: 12, color: '#D32F2F', lineHeight: 1.2 }}>{hr}</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem' }}>HR bpm</Typography>
                </Box>
              )}
            </Box>
            {recordedAt && (
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.55rem', display: 'block', mt: 0.25 }}>
                {new Date(recordedAt).toLocaleDateString('en-AU')}
              </Typography>
            )}
          </>
        ) : (
          <Typography variant="body2" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ lineHeight: 1.3 }}>No data</Typography>
        )}
      </CardContent>
    </Card>
  );
}

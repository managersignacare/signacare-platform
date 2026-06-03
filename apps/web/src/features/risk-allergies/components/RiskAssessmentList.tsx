// apps/web/src/features/risk-allergies/components/RiskAssessmentList.tsx
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import HealthAndSafetyOutlinedIcon from '@mui/icons-material/HealthAndSafetyOutlined';
import { useRiskAssessments, useDeleteRiskAssessment } from '../hooks/useRisk';
import { RISK_LEVEL_CONFIG, isHighRisk } from '../types/riskTypes';
import type { RiskAssessmentResponse } from '../types/riskTypes';
import { RiskAssessmentForm } from './RiskAssessmentForm';
import { RiskScoreGauge } from './RiskScoreGauge';

interface Props {
  patientId: string;
  episodeId?: string;
  readOnly?: boolean;
}

type RiskAssessmentWithLegacyNextReviewDate = RiskAssessmentResponse & {
  nextReviewDate?: string | null;
};

function resolveReviewDate(assessment: RiskAssessmentResponse): string | undefined {
  if (assessment.reviewDate) return assessment.reviewDate;
  const legacyAssessment = assessment as RiskAssessmentWithLegacyNextReviewDate;
  return legacyAssessment.nextReviewDate ?? undefined;
}

export const RiskAssessmentList: React.FC<Props> = ({
  patientId,
  episodeId,
  readOnly = false,
}) => {
  const { data: assessments, isLoading } = useRiskAssessments(patientId, episodeId);
  const deleteMutation = useDeleteRiskAssessment();
  const [formOpen, setFormOpen] = useState(false);
  const [gaugeTarget, setGaugeTarget] = useState<RiskAssessmentResponse | null>(null);

  const latest = assessments?.[0];
  const highRisk = latest && isHighRisk(latest.overallRiskLevel);

  const handleDelete = (id: string) => {
    if (!window.confirm('Soft-delete this risk assessment? It will be retained for audit purposes.')) return;
    deleteMutation.mutate({ patientId, id });
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress role="progressbar" aria-label="Loading" size={28} />
      </Box>
    );
  }

  return (
    <Box>
      {highRisk && latest && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          High Risk Alert — {RISK_LEVEL_CONFIG[latest.overallRiskLevel].label}. Latest risk assessment on {new Date(latest.assessmentDate).toLocaleDateString('en-AU')}. Review management plan.
        </Alert>
      )}

      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
          <HealthAndSafetyOutlinedIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>
            Risk Assessments
          </Typography>
        </Box>
        {!readOnly && (
          <Button
            startIcon={<AddIcon />}
            variant="contained"
            size="small"
            onClick={() => setFormOpen(true)}
          >
            New Assessment
          </Button>
        )}
      </Box>

      {(!assessments || assessments.length === 0) ? (
        <Typography variant="body2" color="text.secondary" py={2}>
          No risk assessments recorded.
        </Typography>
      ) : (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="center">Score</TableCell>
                <TableCell>Overall Risk</TableCell>
                <TableCell>Self-Harm</TableCell>
                <TableCell>Harm to Others</TableCell>
                <TableCell>Vulnerability</TableCell>
                <TableCell>Next Review</TableCell>
                <TableCell>Assessed By</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {assessments.map((a) => {
                const cfg = RISK_LEVEL_CONFIG[a.overallRiskLevel];
                const reviewDate = resolveReviewDate(a);
                return (
                  <TableRow
                    key={a.id}
                    hover
                    sx={isHighRisk(a.overallRiskLevel) ? { bgcolor: 'error.light' } : undefined}
                  >
                    <TableCell>
                      {new Date(a.assessmentDate).toLocaleDateString('en-AU')}
                    </TableCell>
                    <TableCell>{a.assessmentType}</TableCell>
                    <TableCell align="center">
                      {a.totalScore !== undefined
                        ? `${a.totalScore}${a.scoreBand ? ` (${a.scoreBand})` : ''}`
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={cfg.label}
                        size="small"
                        sx={{ bgcolor: cfg.colour, color: '#fff', fontWeight: 700 }}
                      />
                    </TableCell>
                    {(['selfHarmRisk', 'harmToOthersRisk', 'vulnerabilityRisk'] as const).map(
                      (field) => {
                        const flagged = a[field];
                        return (
                          <TableCell key={field}>
                            {flagged
                              ? <Chip label="Yes" size="small" sx={{ bgcolor: '#D32F2F', color: '#fff', fontWeight: 700 }} />
                              : <Typography variant="caption" color="text.secondary">—</Typography>}
                          </TableCell>
                        );
                      },
                    )}
                    <TableCell>
                      {reviewDate
                        ? new Date(reviewDate).toLocaleDateString('en-AU')
                        : '—'}
                    </TableCell>
                    <TableCell>{a.assessorName ?? '—'}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="View gauge">
                        <IconButton size="small" onClick={() => setGaugeTarget(a)}>
                          <VisibilityOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      {!readOnly && (
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDelete(a.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* New Assessment dialog */}
      <Dialog aria-labelledby="dialog-title" open={formOpen} onClose={() => setFormOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle id="dialog-title">New Risk Assessment</DialogTitle>
        <DialogContent dividers>
          <RiskAssessmentForm
            patientId={patientId}
            episodeId={episodeId}
            onSuccess={() => setFormOpen(false)}
            onCancel={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Gauge viewer dialog */}
      <Dialog aria-labelledby="dialog-title"
        open={!!gaugeTarget}
        onClose={() => setGaugeTarget(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="dialog-title">Risk Score — {gaugeTarget?.assessmentType}</DialogTitle>
        <DialogContent dividers>
          {gaugeTarget && (
            <RiskScoreGauge
              score={gaugeTarget.totalScore ?? 0}
              maxScore={100}
              level={gaugeTarget.overallRiskLevel}
            />
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
};

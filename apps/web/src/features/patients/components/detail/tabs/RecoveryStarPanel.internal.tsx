import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import {
  Box,
  Button,
  Collapse,
  Divider,
  Paper,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { apiClient } from '../../../../../shared/services/apiClient';
import { physicalHealthKeys } from '../../../queryKeys';
import { type NursingAssessmentHistoryRow } from './alertsPlansTabSupport';

interface RecoveryStarPanelProps {
  patientId: string;
}

export function RecoveryStarPanel({ patientId }: RecoveryStarPanelProps) {
  const qc = useQueryClient();
  const [s1, setS1] = useState(5);
  const [s2, setS2] = useState(5);
  const [s3, setS3] = useState(5);
  const [s4, setS4] = useState(5);
  const [s5, setS5] = useState(5);
  const [s6, setS6] = useState(5);
  const [s7, setS7] = useState(5);
  const [s8, setS8] = useState(5);
  const [s9, setS9] = useState(5);
  const [s10, setS10] = useState(5);
  const [expandedStarId, setExpandedStarId] = useState<string | null>(null);

  const domainState = [
    { name: 'Managing Mental Health', val: s1, set: setS1 },
    { name: 'Physical Health', val: s2, set: setS2 },
    { name: 'Living Skills', val: s3, set: setS3 },
    { name: 'Social Networks', val: s4, set: setS4 },
    { name: 'Work', val: s5, set: setS5 },
    { name: 'Relationships', val: s6, set: setS6 },
    { name: 'Addictive Behaviour', val: s7, set: setS7 },
    { name: 'Responsibilities', val: s8, set: setS8 },
    { name: 'Identity & Self-Esteem', val: s9, set: setS9 },
    { name: 'Trust & Hope', val: s10, set: setS10 },
  ];

  const allVals = [s1, s2, s3, s4, s5, s6, s7, s8, s9, s10];
  const avg = allVals.reduce((a, b) => a + b, 0) / 10;
  const avgColor = avg >= 7 ? '#2E7D32' : avg >= 4 ? '#b8621a' : '#D32F2F';

  const { data: history } = useQuery({
    queryKey: physicalHealthKeys.nursingAssessmentsRecoveryStar(patientId),
    queryFn: async () => {
      try {
        const r = await apiClient.get<{ data?: NursingAssessmentHistoryRow[] } | NursingAssessmentHistoryRow[]>(
          `nursing-assessments?patientId=${patientId}`,
        );
        const all = Array.isArray(r) ? r : Array.isArray(r.data) ? r.data : [];
        return all
          .filter((a) => a.scores?.scale === 'recovery_star' || (a.assessmentType === 'outcome_measure' && a.scores?.scale === 'recovery_star'))
          .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
      } catch {
        return [];
      }
    },
    enabled: !!patientId,
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const scores: Record<string, number> = {};
      domainState.forEach((d) => {
        scores[d.name] = d.val;
      });
      return apiClient.post('nursing-assessments', {
        patientId,
        assessmentType: 'outcome_measure',
        scores: { scale: 'recovery_star', ...scores },
        totalScore: Math.round(avg * 10),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: physicalHealthKeys.nursingAssessmentsAll() });
      await qc.invalidateQueries({ queryKey: physicalHealthKeys.nursingAssessmentsRecoveryStar(patientId) });
    },
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Recovery Star</Typography>
        <Box sx={{ textAlign: 'center' }}>
          <Typography variant="h4" fontWeight={800} sx={{ color: avgColor, lineHeight: 1 }}>{avg.toFixed(1)}</Typography>
          <Typography variant="caption" color="text.secondary">Average Score</Typography>
        </Box>
      </Box>

      <Paper variant="outlined" sx={{ p: 2.5, mb: 2 }}>
        {domainState.map((domain) => {
          const val = domain.val;
          const color = val >= 7 ? '#2E7D32' : val >= 4 ? '#b8621a' : '#D32F2F';
          return (
            <Box key={domain.name} sx={{ mb: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                <Typography variant="caption" fontWeight={600} sx={{ fontSize: 11 }}>{domain.name}</Typography>
                <Typography variant="caption" fontWeight={700} sx={{ color, fontSize: 11 }}>{val}/10</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box sx={{ flex: 1, height: 8, bgcolor: '#eee', borderRadius: 4, overflow: 'hidden' }}>
                  <Box
                    sx={{
                      height: '100%',
                      width: `${val * 10}%`,
                      bgcolor: color,
                      borderRadius: 4,
                      transition: 'width 0.3s',
                    }}
                  />
                </Box>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={val}
                  style={{ width: 80 }}
                  onChange={(e) => domain.set(parseInt(e.target.value, 10) || 5)}
                />
              </Box>
            </Box>
          );
        })}
        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="contained" size="small" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
            sx={{ bgcolor: '#327C8D', textTransform: 'none' }}>
            {saveMut.isPending ? 'Saving...' : 'Save Recovery Star'}
          </Button>
        </Box>
      </Paper>

      {(history ?? []).length > 0 && (
        <Box sx={{ mt: 1 }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: '#555' }}>
            Previous Assessments
          </Typography>
          {(history ?? []).map((h, i: number) => {
            const hKey = h.id ?? String(i);
            const date = h.createdAt ? new Date(h.createdAt).toLocaleDateString('en-AU') : '—';
            const total = h.totalScore ?? 0;
            const scoreAvg = (total / 10).toFixed(1);
            const scoreColor = Number(scoreAvg) >= 7 ? '#2E7D32' : Number(scoreAvg) >= 4 ? '#b8621a' : '#D32F2F';
            const isStarExpanded = expandedStarId === hKey;
            const domainScores: Record<string, number> = (h.scores && typeof h.scores === 'object')
              ? Object.fromEntries(
                Object.entries(h.scores as Record<string, unknown>)
                  .filter(([k]) => k !== 'scale')
                  .map(([k, v]) => [k, Number(v)] as const),
                )
              : {};
            return (
              <Paper
                key={hKey}
                variant="outlined"
                sx={{ mb: 1, borderLeft: `3px solid ${scoreColor}`, transition: 'box-shadow 0.2s', '&:hover': { boxShadow: 2 } }}
              >
                <Box
                  role="button"
                  tabIndex={0}
                  aria-expanded={isStarExpanded}
                  aria-label={`Toggle Recovery Star Assessment ${date} details`}
                  onClick={() => setExpandedStarId(isStarExpanded ? null : hKey)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedStarId(isStarExpanded ? null : hKey);
                    }
                  }}
                  sx={{
                    px: 2, py: 1.5, cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                    alignItems: 'center', '&:focus-visible': { outline: `2px solid ${scoreColor}`, outlineOffset: 2 },
                  }}
                >
                  <Box>
                    <Typography variant="body2" fontWeight={600}>{date}</Typography>
                    <Typography variant="caption" color="text.secondary">Recovery Star Assessment</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h6" fontWeight={700} sx={{ color: scoreColor, lineHeight: 1 }}>{scoreAvg}</Typography>
                      <Typography variant="caption" color="text.secondary">avg ({total} total)</Typography>
                    </Box>
                    {isStarExpanded ? <ExpandLessIcon fontSize="small" sx={{ color: '#999' }} /> : <ExpandMoreIcon fontSize="small" sx={{ color: '#999' }} />}
                  </Box>
                </Box>

                <Box sx={{ px: 2, pb: 1.5 }}>
                  <Collapse in={isStarExpanded} timeout="auto" unmountOnExit>
                    <Divider sx={{ my: 1.5 }} />
                    <Typography variant="caption" fontWeight={700} sx={{ display: 'block', mb: 1, color: '#555' }}>
                      Domain Scores
                    </Typography>
                    {Object.keys(domainScores).length > 0 ? (
                      Object.entries(domainScores).map(([domain, score]) => {
                        const numScore = Number(score);
                        const domainColor = numScore >= 7 ? '#2E7D32' : numScore >= 4 ? '#b8621a' : '#D32F2F';
                        const domainBg = numScore >= 7 ? '#E8F5E9' : numScore >= 4 ? '#FFF3E0' : '#FFEBEE';
                        return (
                          <Box key={domain} sx={{ mb: 1 }}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                              <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 500 }}>{domain}</Typography>
                              <Typography variant="caption" fontWeight={700} sx={{ color: domainColor, fontSize: 11 }}>
                                {numScore}/10
                              </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Box sx={{ flex: 1, height: 10, bgcolor: domainBg, borderRadius: 5, overflow: 'hidden' }}>
                                <Box
                                  sx={{
                                    height: '100%',
                                    width: `${numScore * 10}%`,
                                    bgcolor: domainColor,
                                    borderRadius: 5,
                                    transition: 'width 0.3s',
                                  }}
                                />
                              </Box>
                            </Box>
                          </Box>
                        );
                      })
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Detailed domain scores not available for this assessment.
                      </Typography>
                    )}
                  </Collapse>
                </Box>
              </Paper>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

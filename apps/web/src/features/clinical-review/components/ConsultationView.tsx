// apps/web/src/features/clinical-review/components/ConsultationView.tsx
import {
  Box,
  Grid,
  Typography,
  Paper,
  Chip,
  Skeleton,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useConsultation } from '../hooks/useClinicalReview';
import { EngagementRapportScale } from './EngagementRapportScale';
import { KeyIssuesPanel } from './KeyIssuesPanel';
import { ReviewPlanSection } from './ReviewPlanSection';
import { format, parseISO } from 'date-fns';
import type { MentalStateExam } from '../types/reviewTypes';

interface Props {
  encounterId: string;
  patientId: string;
  episodeId: string | null;
  readOnly?: boolean;
}

const MSE_FIELDS: Array<{ key: keyof MentalStateExam; label: string }> = [
  { key: 'appearance', label: 'Appearance' },
  { key: 'behaviour', label: 'Behaviour' },
  { key: 'speech', label: 'Speech' },
  { key: 'mood', label: 'Mood' },
  { key: 'affect', label: 'Affect' },
  { key: 'thoughtForm', label: 'Thought Form' },
  { key: 'thoughtContent', label: 'Thought Content' },
  { key: 'perception', label: 'Perception' },
  { key: 'cognition', label: 'Cognition' },
  { key: 'insight', label: 'Insight' },
  { key: 'judgement', label: 'Judgement' },
];

export function ConsultationView({
  encounterId,
  patientId,
  episodeId,
  readOnly = false,
}: Props) {
  const { data, isLoading, isError } = useConsultation(encounterId);

  if (isLoading) return <Skeleton height={300} />;
  if (isError || !data)
    return <Alert role="alert" severity="error">Unable to load consultation details.</Alert>;

  return (
    <Box>
      {/* Header */}
      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid>
            <Typography variant="h6">
              {format(parseISO(data.encounterDate), 'EEEE dd MMMM yyyy')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {data.clinicianName} — {data.encounterType.replace(/([A-Z])/g, ' $1')}
              {data.durationMinutes ? ` — ${data.durationMinutes} min` : ''}
            </Typography>
          </Grid>
          <Grid sx={{ ml: 'auto' }}>
            <Chip
              label={data.status}
              color={
                data.status === 'signed'
                  ? 'success'
                  : data.status === 'completed'
                  ? 'info'
                  : 'default'
              }
            />
          </Grid>
        </Grid>
      </Paper>

      {/* Presenting Complaints */}
      {data.presentingComplaints && (
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">Presenting Complaints</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography variant="body2" whiteSpace="pre-wrap">
              {data.presentingComplaints}
            </Typography>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Mental State Exam */}
      {data.mentalStateExam && (
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle2">Mental State Examination</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Grid container spacing={2}>
              {MSE_FIELDS.map(({ key, label }) => {
                const val = data.mentalStateExam?.[key];
                if (!val) return null;
                return (
                  <Grid size={{ xs: 12, sm: 6, md: 4 }} key={key}>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      fontWeight={600}
                      display="block"
                    >
                      {label}
                    </Typography>
                    <Typography variant="body2">{val}</Typography>
                  </Grid>
                );
              })}
            </Grid>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Engagement Rapport */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">Engagement / Rapport</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <EngagementRapportScale
            encounterId={encounterId}
            patientId={patientId}
            initialValues={data.engagementScore ?? undefined}
            readOnly={readOnly}
          />
        </AccordionDetails>
      </Accordion>

      {/* Key Issues */}
      <Accordion>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">
            Key Issues ({data.keyIssues.length})
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <KeyIssuesPanel
            encounterId={encounterId}
            patientId={patientId}
            initialIssues={data.keyIssues}
            readOnly={readOnly}
          />
        </AccordionDetails>
      </Accordion>

      {/* Review Plan */}
      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="subtitle2">Review Plan</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <ReviewPlanSection
            encounterId={encounterId}
            patientId={patientId}
            episodeId={episodeId}
            initialPlan={data.planText ?? undefined}
            readOnly={readOnly}
          />
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}

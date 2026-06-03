// apps/web/src/features/clinical-review/components/ClinicalReviewView.tsx
import React, { useState } from 'react';
import {
  Box,
  Grid,
  Typography,
  Chip,
  Alert,
  Skeleton,
  Tabs,
  Tab,
  Paper,
  Divider,
  Badge,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import MedicationIcon from '@mui/icons-material/Medication';
import GavelIcon from '@mui/icons-material/Gavel';
import TimelineIcon from '@mui/icons-material/Timeline';
import { useClinicalReview } from '../hooks/useClinicalReview';
import type {
  PatientFlag,
  Diagnosis,
  CurrentMedication,
  LAISchedule,
  RiskHistoryEntry,
  MHActOrder,
  EncounterTimelineEntry,
} from '../types/reviewTypes';
import { format, parseISO } from 'date-fns';

interface Props {
  patientId: string;
  episodeId?: string;
  onSelectEncounter?: (encounterId: string) => void;
}

const SEVERITY_COLOUR: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  urgent: 'error',
  high: 'warning',
  medium: 'info',
  low: 'default',
};

const RISK_COLOUR: Record<string, string> = {
  veryhigh: '#d32f2f',
  high: '#f57c00',
  moderate: '#fbc02d',
  low: '#388e3c',
};

interface FlagBadgeProps { flag: PatientFlag }
function FlagBadge({ flag }: FlagBadgeProps) {
  return (
    <Chip
      icon={<WarningAmberIcon fontSize="small" />}
      label={flag.title}
      color={SEVERITY_COLOUR[flag.severity]}
      size="small"
      variant="outlined"
      sx={{ mb: 0.5, mr: 0.5 }}
    />
  );
}

interface DiagnosisRowProps { dx: Diagnosis }
function DiagnosisRow({ dx }: DiagnosisRowProps) {
  return (
    <Box display="flex" alignItems="center" gap={1} py={0.5}>
      {dx.isPrimary && <Chip label="Primary" size="small" color="primary" />}
      <Typography variant="body2" fontWeight={dx.isPrimary ? 600 : 400}>
        {dx.icdCode} — {dx.description}
      </Typography>
      <Chip label={dx.status} size="small" variant="outlined" />
      <Typography variant="caption" color="text.secondary">
        {dx.diagnosedDate}
      </Typography>
    </Box>
  );
}

interface MedicationRowProps { med: CurrentMedication }
function MedicationRow({ med }: MedicationRowProps) {
  return (
    <Box display="flex" alignItems="center" gap={1} py={0.5}>
      <MedicationIcon fontSize="small" color={med.isClozapine ? 'error' : 'action'} />
      <Typography variant="body2">
        {med.drugName} {med.dose} {med.route ? `(${med.route})` : ''} {med.frequency}
      </Typography>
      {med.isLai && <Chip label="LAI" size="small" color="secondary" />}
      {med.isClozapine && <Chip label="Clozapine" size="small" color="error" />}
      <Chip label={med.status} size="small" variant="outlined" />
    </Box>
  );
}

interface LAIRowProps { lai: LAISchedule }
function LAIRow({ lai }: LAIRowProps) {
  return (
    <Box
      display="flex"
      alignItems="center"
      gap={1}
      py={0.5}
      sx={lai.isOverdue ? { bgcolor: 'error.lighter', borderRadius: 1, px: 1 } : {}}
    >
      <Typography variant="body2" fontWeight={500}>
        {lai.drugName} {lai.doseGiven}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Every {lai.frequencyDays}d
      </Typography>
      {lai.nextDueDate && (
        <Typography variant="caption">
          Next due: {format(parseISO(lai.nextDueDate), 'dd/MM/yyyy')}
        </Typography>
      )}
      {lai.isOverdue && (
        <Chip label={`Overdue ${lai.daysOverdue ?? ''}d`} size="small" color="error" />
      )}
    </Box>
  );
}

interface RiskRowProps { entry: RiskHistoryEntry }
function RiskRow({ entry }: RiskRowProps) {
  return (
    <Box display="flex" alignItems="center" gap={1} py={0.5}>
      <Box
        sx={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          bgcolor: RISK_COLOUR[entry.riskLevel] ?? 'grey',
          flexShrink: 0,
        }}
      />
      <Typography variant="body2" textTransform="capitalize">
        {entry.riskDomain.replace(/([A-Z])/g, ' $1')}
      </Typography>
      <Chip label={entry.riskLevel.replace(/([A-Z])/g, ' $1')} size="small" />
      <Typography variant="caption" color="text.secondary">
        {format(parseISO(entry.assessmentDate), 'dd/MM/yyyy')}
      </Typography>
    </Box>
  );
}

interface MHActRowProps { order: MHActOrder }
function MHActRow({ order }: MHActRowProps) {
  const expiring = order.daysUntilExpiry !== null && order.daysUntilExpiry < 14;
  return (
    <Box display="flex" alignItems="center" gap={1} py={0.5}>
      <GavelIcon fontSize="small" color={expiring ? 'error' : 'action'} />
      <Typography variant="body2" fontWeight={500}>
        {order.orderType}
      </Typography>
      {order.orderNumber && (
        <Typography variant="caption" color="text.secondary">
          {order.orderNumber}
        </Typography>
      )}
      <Chip
        label={order.status}
        size="small"
        color={order.status === 'active' ? 'success' : 'default'}
      />
      {expiring && (
        <Chip
          label={`Expires in ${order.daysUntilExpiry}d`}
          size="small"
          color="error"
        />
      )}
    </Box>
  );
}

interface TimelineRowProps { entry: EncounterTimelineEntry;
  onClick: (id: string) => void; }
function TimelineRow({ entry,
  onClick, }: TimelineRowProps) {
  return (
    <Box
      role="button"
      tabIndex={0}
      aria-label={`Open encounter from ${format(parseISO(entry.encounterDate), 'dd/MM/yyyy HH:mm')}`}
      onClick={() => onClick(entry.encounterId)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(entry.encounterId); } }}
      display="flex"
      alignItems="flex-start"
      gap={2}
      py={1}
      sx={{
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
        '&:focus-visible': { outline: '2px solid #327C8D', outlineOffset: 2 },
        borderRadius: 1,
        px: 1,
      }}
    >
      <Box display="flex" flexDirection="column" alignItems="center" sx={{ minWidth: 80 }}>
        <Typography variant="caption" fontWeight={600}>
          {format(parseISO(entry.encounterDate), 'dd/MM/yyyy')}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {format(parseISO(entry.encounterDate), 'HH:mm')}
        </Typography>
      </Box>
      <Box>
        <Chip
          label={entry.encounterType.replace(/([A-Z])/g, ' $1')}
          size="small"
          variant="outlined"
          sx={{ mb: 0.5 }}
        />
        <Typography variant="body2">{entry.clinicianName}</Typography>
        {entry.summary && (
          <Typography
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ maxWidth: 400, display: 'block' }}
          >
            {entry.summary}
          </Typography>
        )}
      </Box>
      {entry.durationMinutes && (
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {entry.durationMinutes}min
        </Typography>
      )}
    </Box>
  );
}

interface TabPanelProps {
  value: number;
  index: number;
  children: React.ReactNode;
}

function TabPanel({ value, index, children }: TabPanelProps) {
  return value === index ? <Box pt={2}>{children}</Box> : null;
}

export function ClinicalReviewView({ patientId, episodeId, onSelectEncounter }: Props) {
  const [tab, setTab] = useState(0);
  const { data, isLoading, isError } = useClinicalReview(patientId, episodeId);

  if (isLoading) {
    return (
      <Box>
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} height={48} sx={{ mb: 1 }} />
        ))}
      </Box>
    );
  }

  if (isError || !data) {
    return (
      <Alert role="alert" severity="error">
        Unable to load clinical review. Please refresh or contact support.
      </Alert>
    );
  }

  const urgentFlags = data.flags.filter(
    (f) => f.severity === 'urgent' || f.severity === 'high',
  );

  return (
    <Box>
      {/* Active Flags Banner */}
      {urgentFlags.length > 0 && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Active Clinical Alerts
          </Typography>
          <Box display="flex" flexWrap="wrap">
            {urgentFlags.map((f) => (
              <FlagBadge key={f.id} flag={f} />
            ))}
          </Box>
        </Alert>
      )}

      {/* All Flags lower severity */}
      {data.flags.filter((f) => f.severity === 'medium' || f.severity === 'low').length > 0 && (
        <Box display="flex" flexWrap="wrap" mb={1}>
          {data.flags
            .filter((f) => f.severity === 'medium' || f.severity === 'low')
            .map((f) => (
              <FlagBadge key={f.id} flag={f} />
            ))}
        </Box>
      )}

      <Tabs aria-label="Navigation tabs"
        value={tab}
        onChange={(_e, v: number) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab label="Diagnoses" />
        <Tab
          label={
            <Badge
              badgeContent={data.laiSchedules.filter((l) => l.isOverdue).length}
              color="error"
            >
              Medications / LAI
            </Badge>
          }
        />
        <Tab
          label={
            <Badge
              badgeContent={
                data.activeMHActOrders.filter(
                  (o) => (o.daysUntilExpiry ?? 999) < 14,
                ).length
              }
              color="warning"
            >
              MH Act
            </Badge>
          }
        />
        <Tab label="Risk History" />
        <Tab
          label="Encounter Timeline"
          icon={<TimelineIcon fontSize="small" />}
          iconPosition="start"
        />
      </Tabs>

      {/* Tab 0 — Diagnoses */}
      <TabPanel value={tab} index={0}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          {data.diagnoses.length === 0 ? (
            <Typography color="text.secondary">No diagnoses recorded.</Typography>
          ) : (
            data.diagnoses.map((dx) => <DiagnosisRow key={dx.id} dx={dx} />)
          )}
        </Paper>
      </TabPanel>

      {/* Tab 1 — Medications / LAI */}
      <TabPanel value={tab} index={1}>
        <Grid container spacing={2}>
          <Grid>
            <Typography variant="subtitle2" gutterBottom>
              Current Medications
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              {data.currentMedications.length === 0 ? (
                <Typography color="text.secondary">No active medications.</Typography>
              ) : (
                data.currentMedications
                  .filter((m) => m.status === 'active')
                  .map((m) => <MedicationRow key={m.id} med={m} />)
              )}
            </Paper>
          </Grid>
          <Grid>
            <Typography variant="subtitle2" gutterBottom>
              LAI Schedules
            </Typography>
            <Paper variant="outlined" sx={{ p: 2 }}>
              {data.laiSchedules.length === 0 ? (
                <Typography color="text.secondary">No LAI schedules.</Typography>
              ) : (
                data.laiSchedules.map((l) => <LAIRow key={l.id} lai={l} />)
              )}
            </Paper>
          </Grid>
        </Grid>
      </TabPanel>

      {/* Tab 2 — MH Act */}
      <TabPanel value={tab} index={2}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          {data.activeMHActOrders.length === 0 ? (
            <Typography color="text.secondary">No active MH Act orders.</Typography>
          ) : (
            data.activeMHActOrders.map((o) => <MHActRow key={o.id} order={o} />)
          )}
        </Paper>
      </TabPanel>

      {/* Tab 3 — Risk History */}
      <TabPanel value={tab} index={3}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          {data.riskHistory.length === 0 ? (
            <Typography color="text.secondary">No risk assessments recorded.</Typography>
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" gutterBottom display="block">
                Most recent assessments per domain
              </Typography>
              {data.riskHistory.map((r) => (
                <RiskRow key={r.id} entry={r} />
              ))}
            </>
          )}
        </Paper>
      </TabPanel>

      {/* Tab 4 — Encounter Timeline */}
      <TabPanel value={tab} index={4}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          {data.encounterTimeline.length === 0 ? (
            <Typography color="text.secondary">No encounters recorded.</Typography>
          ) : (
            data.encounterTimeline.map((entry, idx) => (
              <React.Fragment key={entry.id}>
                <TimelineRow
                  entry={entry}
                  onClick={(id) => onSelectEncounter?.(id)}
                />
                {idx < data.encounterTimeline.length - 1 && <Divider />}
              </React.Fragment>
            ))
          )}
        </Paper>
      </TabPanel>

      {data.lastReviewDate && (
        <Typography variant="caption" color="text.secondary" mt={2} display="block">
          Last reviewed: {format(parseISO(data.lastReviewDate), 'dd/MM/yyyy HH:mm')}
        </Typography>
      )}
    </Box>
  );
}

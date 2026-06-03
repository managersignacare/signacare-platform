/**
 * Patient Tracking Tab — Zitavi Mobile App Data
 * Displays patient-reported data from the Zitavi mobile app via EMR Gateway.
 * Sub-tabs: Overview, Alerts & Allergies, Vitals, Medications, Mood & Journal
 */

import BloodtypeIcon from '@mui/icons-material/Bloodtype';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import MedicationIcon from '@mui/icons-material/Medication';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import MoodIcon from '@mui/icons-material/Mood';
import PeopleIcon from '@mui/icons-material/People';
import StraightenIcon from '@mui/icons-material/Straighten';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
    Alert, Box, Card, CardContent, Chip, CircularProgress, FormControl,
    Grid, InputLabel, MenuItem, Paper, Select, Tab, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, Tabs, Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { usePatient } from '../../../hooks/usePatient';

// Zitavi API calls are proxied through the backend to keep the API key server-side
import { apiClient } from '../../../../../shared/services/apiClient';
import { zitaviKeys } from '../../../queryKeys';

interface GatewayResponse<T> {
  success?: boolean;
  data?: T;
}

interface ZitaviPatientSearchResult {
  _id: string;
  firstName?: string;
  lastName?: string;
}

interface MoodEntry {
  recordedAt?: string;
  mood: number;
  moodLabel?: string;
}

interface HealthConditionEntry {
  healthConditionDiagnosis?: string;
  healthConditionDescription?: string;
  diagnosisDate?: string;
  status?: string;
}

interface AlertEntry {
  dateTime?: string;
  msgType?: string;
  message?: string;
  status?: string;
}

interface AppAllergyEntry {
  Anaphylaxis?: string;
  AllergicReactionADR?: string;
  isActive?: boolean;
  updatedAt?: string;
}

interface SupportPersonEntry {
  name?: string;
  relationship?: string;
  phone?: { countryCode?: string; number?: string };
  email?: string;
  shareConsent?: string;
}

interface WeightVitalEntry {
  recordedAt?: string;
  value: number;
  unit?: string;
  bmi?: number;
}

interface NumericVitalEntry {
  recordedAt?: string;
  value: number;
  unit?: string;
}

interface BloodPressureEntry {
  recordedAt?: string;
  systolic: number;
  diastolic: number;
  pulse?: number;
}

interface BloodSugarEntry {
  recordedAt?: string;
  value: number;
  unit?: string;
  mealTime?: string;
}

interface MedicationEntry {
  medicationName?: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  isActive?: boolean;
  updatedAt?: string;
}

interface JournalAttachment {
  fileName?: string;
}

interface JournalEntry {
  title?: string;
  isPrivate?: boolean;
  createdAt?: string;
  content?: string;
  attachments?: JournalAttachment[];
}

interface RatingCategoryEntry {
  _id: string;
  name?: string;
}

interface RatingValueEntry {
  createdAt?: string;
  rating: number;
  note?: string;
}

interface RatingEntry {
  categoryId?: string;
  ratings?: RatingValueEntry[];
}

interface TrackingSummaryVitals {
  weight?: WeightVitalEntry;
  heartRate?: NumericVitalEntry;
  bloodPressure?: BloodPressureEntry;
  bloodSugar?: BloodSugarEntry;
  temperature?: NumericVitalEntry;
  abdominalCircumference?: NumericVitalEntry;
}

interface TrackingSummary {
  latestVitals?: TrackingSummaryVitals;
  patient?: {
    firstName?: string;
    lastName?: string;
    campaignDetails?: { status?: string };
  };
  recentMoodEntries?: MoodEntry[];
  activeHealthConditions?: HealthConditionEntry[];
  recentAlerts?: AlertEntry[];
  activeAllergies?: AppAllergyEntry[];
}

function unwrapGatewayResponse<T>(response: GatewayResponse<T> | T | null): T | null {
  if (response === null) return null;
  if (typeof response === 'object' && response !== null && 'success' in response) {
    const wrapped = response as GatewayResponse<T>;
    if (wrapped.success === false) return null;
    if (wrapped.data !== undefined) return wrapped.data;
    return null;
  }
  return response as T;
}

async function gw<T>(path: string): Promise<T | null> {
  try {
    const response = await apiClient.get<GatewayResponse<T> | T>(`patients/zitavi-proxy${path}`);
    return unwrapGatewayResponse(response);
  } catch { return null; }
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtDateTime(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-AU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const MOOD_LABELS: Record<number, string> = {
  1: 'Very Poor', 2: 'Poor', 3: 'Slightly Unhappy', 4: 'Somewhat Unhappy',
  5: 'Neutral', 6: 'Slightly Happy', 7: 'Somewhat Happy', 8: 'Good',
  9: 'Very Good', 10: 'Excellent',
};
const MOOD_COLORS: Record<number, string> = {
  1: '#D32F2F', 2: '#E53935', 3: '#F57C00', 4: '#FFA000',
  5: '#9E9E9E', 6: '#7CB342', 7: '#43A047', 8: '#2E7D32',
  9: '#1B5E20', 10: '#0D47A1',
};

type TrackingSubTab = 'overview' | 'alerts-allergies' | 'vitals' | 'medications' | 'mood-journal';

interface TrackingTabProps { patientId: string }
export function TrackingTab({ patientId }: TrackingTabProps) {
  const { data: emrPatient } = usePatient(patientId);
  const [tab, setTab] = useState<TrackingSubTab>('overview');
  const [selectedMetric, setSelectedMetric] = useState('mood');

  // Search Zitavi by first name (most unique), then fall back to last name
  const firstName = emrPatient?.givenName ?? '';
  const lastName = emrPatient?.familyName ?? '';
  const searchTerm = firstName || lastName;

  const { data: zitaviPatients } = useQuery({
    queryKey: zitaviKeys.search(firstName, lastName),
    queryFn: async () => {
      if (!searchTerm) return null;
      // Try first name search
      let results = await gw<ZitaviPatientSearchResult[]>(`/patients?search=${encodeURIComponent(firstName)}&limit=10`);
      if (results && results.length > 0) {
        // Filter to match both first AND last name
        const match = results.find((p) =>
          (p.firstName ?? '').toLowerCase() === firstName.toLowerCase() &&
          (p.lastName ?? '').toLowerCase() === lastName.toLowerCase()
        );
        if (match) return [match];
        // Partial match on last name
        const partial = results.find((p) =>
          (p.lastName ?? '').toLowerCase() === lastName.toLowerCase()
        );
        if (partial) return [partial];
      }
      // Fall back to last name search
      if (lastName) {
        results = await gw<ZitaviPatientSearchResult[]>(`/patients?search=${encodeURIComponent(lastName)}&limit=10`);
        if (results && results.length > 0) {
          const match = results.find((p) =>
            (p.firstName ?? '').toLowerCase() === firstName.toLowerCase()
          );
          if (match) return [match];
          return [results[0]];
        }
      }
      return results;
    },
    enabled: !!searchTerm && !!searchTerm,
    staleTime: 60_000,
  });
  const zitaviId = zitaviPatients?.[0]?._id;
  const zitaviKeyId = zitaviId ?? '';

  // Summary (overview data)
  const { data: summary, isLoading } = useQuery({
    queryKey: zitaviKeys.summary(zitaviKeyId),
    queryFn: () => zitaviId ? gw<TrackingSummary>(`/patients/${zitaviId}/summary`) : null,
    enabled: !!zitaviId, staleTime: 30_000,
  });

  // Detailed data per tab
  const { data: allAlerts } = useQuery({
    queryKey: zitaviKeys.alerts(zitaviKeyId),
    queryFn: () => gw<AlertEntry[]>(`/patients/${zitaviId}/alerts?limit=50`),
    enabled: !!zitaviId && tab === 'alerts-allergies',
  });
  const { data: allAllergies } = useQuery({
    queryKey: zitaviKeys.allergies(zitaviKeyId),
    queryFn: () => gw<AppAllergyEntry[]>(`/patients/${zitaviId}/allergies?limit=50`),
    enabled: !!zitaviId && tab === 'alerts-allergies',
  });
  const { data: healthConditions } = useQuery({
    queryKey: zitaviKeys.conditions(zitaviKeyId),
    queryFn: () => gw<HealthConditionEntry[]>(`/patients/${zitaviId}/health-conditions?limit=50`),
    enabled: !!zitaviId && tab === 'alerts-allergies',
  });
  const { data: weightHistory } = useQuery({
    queryKey: zitaviKeys.weight(zitaviKeyId),
    queryFn: () => gw<WeightVitalEntry[]>(`/patients/${zitaviId}/vitals/weight?limit=30`),
    enabled: !!zitaviId && tab === 'vitals',
  });
  const { data: hrHistory } = useQuery({
    queryKey: zitaviKeys.heartrate(zitaviKeyId),
    queryFn: () => gw<NumericVitalEntry[]>(`/patients/${zitaviId}/vitals/heart-rate?limit=30`),
    enabled: !!zitaviId && tab === 'vitals',
  });
  const { data: bpHistory } = useQuery({
    queryKey: zitaviKeys.bp(zitaviKeyId),
    queryFn: () => gw<BloodPressureEntry[]>(`/patients/${zitaviId}/vitals/blood-pressure?limit=30`),
    enabled: !!zitaviId && tab === 'vitals',
  });
  const { data: bsHistory } = useQuery({
    queryKey: zitaviKeys.bloodsugar(zitaviKeyId),
    queryFn: () => gw<BloodSugarEntry[]>(`/patients/${zitaviId}/vitals/blood-sugar?limit=30`),
    enabled: !!zitaviId && tab === 'vitals',
  });
  const { data: tempHistory } = useQuery({
    queryKey: zitaviKeys.temp(zitaviKeyId),
    queryFn: () => gw<NumericVitalEntry[]>(`/patients/${zitaviId}/vitals/temperature?limit=30`),
    enabled: !!zitaviId && tab === 'vitals',
  });
  const { data: abdomHistory } = useQuery({
    queryKey: zitaviKeys.abdominal(zitaviKeyId),
    queryFn: () => gw<NumericVitalEntry[]>(`/patients/${zitaviId}/vitals/abdominal-circumference?limit=30`),
    enabled: !!zitaviId && (tab === 'vitals' || tab === 'overview'),
  });
  const { data: allMeds } = useQuery({
    queryKey: zitaviKeys.medications(zitaviKeyId),
    queryFn: () => gw<MedicationEntry[]>(`/patients/${zitaviId}/medications?limit=50`),
    enabled: !!zitaviId && tab === 'medications',
  });
  const { data: allMoods } = useQuery({
    queryKey: zitaviKeys.moods(zitaviKeyId),
    queryFn: () => gw<MoodEntry[]>(`/patients/${zitaviId}/mood-entries?limit=30`),
    enabled: !!zitaviId && (tab === 'mood-journal' || tab === 'vitals'),
  });
  const { data: journals } = useQuery({
    queryKey: zitaviKeys.journals(zitaviKeyId),
    queryFn: () => gw<JournalEntry[]>(`/patients/${zitaviId}/journal-entries?limit=20`),
    enabled: !!zitaviId && tab === 'mood-journal',
  });
  const { data: supportPersons } = useQuery({
    queryKey: zitaviKeys.support(zitaviKeyId),
    queryFn: () => gw<SupportPersonEntry[]>(`/patients/${zitaviId}/support-persons?limit=20`),
    enabled: !!zitaviId && tab === 'alerts-allergies',
  });
  // Rating categories & entries (custom tracking items like energy, anxiety)
  const { data: ratingCategories } = useQuery({
    queryKey: zitaviKeys.ratingCats(zitaviKeyId),
    queryFn: () => gw<RatingCategoryEntry[]>(`/patients/${zitaviId}/rating-categories`),
    enabled: !!zitaviId && tab === 'vitals',
  });
  const { data: ratingEntries } = useQuery({
    queryKey: zitaviKeys.ratings(zitaviKeyId),
    queryFn: () => gw<RatingEntry[]>(`/patients/${zitaviId}/ratings?limit=100`),
    enabled: !!zitaviId && tab === 'vitals',
  });

  if (!emrPatient) return (
    <Box><Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Patient Tracking</Typography>
      <Alert severity="info">Loading patient data...</Alert>
    </Box>
  );

  if (isLoading) return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress role="progressbar" aria-label="Loading" sx={{ color: '#b8621a' }} /></Box>;

  if (!summary) return (
    <Box><Typography variant="h6" fontWeight={600} sx={{ mb: 2 }}>Patient Tracking</Typography>
      <Alert role="alert" severity="warning">No matching patient found in Zitavi mobile app. Ensure the patient has a linked account.</Alert>
    </Box>
  );

  const v = summary.latestVitals ?? {};
  const zp = summary.patient ?? {};

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h6" fontWeight={600}>Patient Tracking</Typography>
        <Chip label="Zitavi Mobile App" size="small" sx={{ bgcolor: '#E8F5E9', color: '#2E7D32', fontWeight: 600, fontSize: 10 }} />
        <Chip label={`${zp.firstName ?? ''} ${zp.lastName ?? ''}`} size="small" variant="outlined" sx={{ fontSize: 10 }} />
        {zp.campaignDetails?.status && (
          <Chip label={`Campaign: ${zp.campaignDetails.status}`} size="small"
            sx={{ bgcolor: zp.campaignDetails.status === 'active' ? '#E8F5E9' : '#FFF3E0', fontSize: 10 }} />
        )}
      </Box>

      {/* Sub-tabs */}
      <Tabs aria-label="Navigation tabs" value={tab} onChange={(_, t) => setTab(t)} variant="scrollable" scrollButtons="auto"
        sx={{ mb: 3, '& .MuiTab-root': { textTransform: 'none', fontSize: 13, fontFamily: 'Albert Sans, sans-serif' } }}>
        <Tab label="Overview" value="overview" icon={<MonitorHeartIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
        <Tab label="Alerts & Allergies" value="alerts-allergies" icon={<WarningAmberIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
        <Tab label="Vitals" value="vitals" icon={<FavoriteIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
        <Tab label="Medications" value="medications" icon={<MedicationIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
        <Tab label="Journal" value="mood-journal" icon={<MenuBookIcon sx={{ fontSize: 16 }} />} iconPosition="start" />
      </Tabs>

      {/* ══════ OVERVIEW ══════ */}
      {tab === 'overview' && (
        <Box>
          {/* Vital cards */}
          <Grid container spacing={1.5} sx={{ mb: 3 }}>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <VitalCard icon={<FitnessCenterIcon />} color="#b8621a" label="Weight"
                value={v.weight ? `${v.weight.value} ${v.weight.unit ?? 'kg'}` : null}
                sub={v.weight?.bmi ? `BMI: ${v.weight.bmi.toFixed(1)}` : undefined} date={v.weight?.recordedAt} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <VitalCard icon={<FavoriteIcon />} color="#D32F2F" label="Heart Rate"
                value={v.heartRate ? `${v.heartRate.value} BPM` : null}
                status={v.heartRate ? hrStatus(v.heartRate.value) : undefined} date={v.heartRate?.recordedAt} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <VitalCard icon={<MonitorHeartIcon />} color="#1565C0" label="Blood Pressure"
                value={v.bloodPressure ? `${v.bloodPressure.systolic}/${v.bloodPressure.diastolic}` : null}
                sub={v.bloodPressure ? `Pulse: ${v.bloodPressure.pulse}` : undefined}
                status={v.bloodPressure ? bpStatus(v.bloodPressure.systolic) : undefined} date={v.bloodPressure?.recordedAt} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <VitalCard icon={<BloodtypeIcon />} color="#7B1FA2" label="Blood Sugar"
                value={v.bloodSugar ? `${v.bloodSugar.value} ${v.bloodSugar.unit ?? 'mg/dL'}` : null}
                sub={v.bloodSugar?.mealTime?.replace('_', ' ')} date={v.bloodSugar?.recordedAt} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <VitalCard icon={<ThermostatIcon />} color="#E65100" label="Temperature"
                value={v.temperature ? `${v.temperature.value}°${v.temperature.unit ?? 'C'}` : null} date={v.temperature?.recordedAt} />
            </Grid>
            <Grid size={{ xs: 6, sm: 4, md: 2 }}>
              <VitalCard icon={<StraightenIcon />} color="#3D484B" label="Waist"
                value={v.abdominalCircumference ? `${v.abdominalCircumference.value} ${v.abdominalCircumference.unit ?? 'cm'}` : null}
                date={v.abdominalCircumference?.recordedAt} />
            </Grid>
          </Grid>

          {/* Mood + Conditions + Support */}
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <MoodIcon sx={{ fontSize: 16, color: '#327C8D' }} /> Recent Mood
                </Typography>
                {(summary.recentMoodEntries ?? []).length === 0 && <Typography variant="body2" color="text.secondary">No mood entries</Typography>}
                {(summary.recentMoodEntries ?? []).map((m, i: number) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, borderBottom: '1px solid #f5f5f5' }}>
                    <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: MOOD_COLORS[m.mood] ?? '#999', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700 }}>{m.mood}</Box>
                    <Typography variant="body2" fontWeight={500} sx={{ fontSize: 12 }}>{m.moodLabel ?? MOOD_LABELS[m.mood]}</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto', fontSize: 9 }}>{fmtDate(m.recordedAt)}</Typography>
                  </Box>
                ))}
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Active Conditions</Typography>
                {(summary.activeHealthConditions ?? []).length === 0 && <Typography variant="body2" color="text.secondary">None</Typography>}
                {(summary.activeHealthConditions ?? []).map((c, i: number) => (
                  <Box key={i} sx={{ py: 0.5, borderBottom: '1px solid #f5f5f5' }}>
                    <Typography variant="body2" fontWeight={500} sx={{ fontSize: 12 }}>{c.healthConditionDiagnosis}</Typography>
                    {c.healthConditionDescription && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{c.healthConditionDescription}</Typography>}
                  </Box>
                ))}
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <WarningAmberIcon sx={{ fontSize: 16, color: '#D32F2F' }} /> Recent Alerts
                </Typography>
                {(summary.recentAlerts ?? []).length === 0 && <Typography variant="body2" color="text.secondary">No alerts</Typography>}
                {(summary.recentAlerts ?? []).map((a, i: number) => (
                  <Box key={i} sx={{ py: 0.5, borderBottom: '1px solid #f5f5f5', display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Chip label={a.msgType} size="small" sx={{ fontSize: 8, height: 16,
                      bgcolor: a.msgType === 'critical' ? '#D32F2F' : a.msgType === 'warning' ? '#F57F17' : '#1565C0', color: '#fff' }} />
                    <Typography variant="body2" sx={{ fontSize: 11, flex: 1 }}>{a.message}</Typography>
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>{fmtDate(a.dateTime)}</Typography>
                  </Box>
                ))}
              </Paper>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* ══════ ALERTS & ALLERGIES ══════ */}
      {tab === 'alerts-allergies' && (
        <Box>
          {/* Alerts */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningAmberIcon sx={{ color: '#D32F2F' }} /> Alerts ({(allAlerts ?? []).length})
          </Typography>
          {(allAlerts ?? []).length === 0 ? <Alert severity="info" sx={{ mb: 3 }}>No alerts from patient app</Alert> : (
            <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined" sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: '#FBF8F5' }}>
                  {['Date', 'Type', 'Message', 'Status'].map(h => <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11 }}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {(allAlerts ?? []).map((a, i: number) => (
                    <TableRow key={i} sx={{ bgcolor: a.msgType === 'critical' ? '#FFF5F5' : undefined }}>
                      <TableCell sx={{ fontSize: 11 }}>{fmtDateTime(a.dateTime)}</TableCell>
                      <TableCell><Chip label={a.msgType} size="small" sx={{ fontSize: 9, height: 18,
                        bgcolor: a.msgType === 'critical' ? '#D32F2F' : a.msgType === 'warning' ? '#F57F17' : '#1565C0', color: '#fff' }} /></TableCell>
                      <TableCell sx={{ fontSize: 11 }}>{a.message}</TableCell>
                      <TableCell><Chip label={a.status} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize',
                        bgcolor: a.status === 'resolved' ? '#E8F5E9' : '#FFF3E0', color: a.status === 'resolved' ? '#2E7D32' : '#b8621a' }} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Allergies */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningAmberIcon sx={{ color: '#b8621a' }} /> Allergies ({(allAllergies ?? []).length})
          </Typography>
          {(allAllergies ?? []).length === 0 ? <Alert severity="info" sx={{ mb: 3 }}>No allergies recorded in app</Alert> : (
            <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined" sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: '#FFF5F5' }}>
                  {['Anaphylaxis', 'Allergic Reaction / ADR', 'Status', 'Updated'].map(h => <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11 }}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {(allAllergies ?? []).map((a, i: number) => (
                    <TableRow key={i}>
                      <TableCell sx={{ fontSize: 11, fontWeight: 600, color: '#D32F2F' }}>{a.Anaphylaxis ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 11 }}>{a.AllergicReactionADR ?? '—'}</TableCell>
                      <TableCell><Chip label={a.isActive ? 'Active' : 'Inactive'} size="small" sx={{ fontSize: 9, height: 18,
                        bgcolor: a.isActive ? '#FDECEA' : '#eee', color: a.isActive ? '#D32F2F' : '#999' }} /></TableCell>
                      <TableCell sx={{ fontSize: 10 }}>{fmtDate(a.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Health Conditions */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>Health Conditions ({(healthConditions ?? []).length})</Typography>
          {(healthConditions ?? []).length === 0 ? <Alert severity="info" sx={{ mb: 3 }}>No conditions recorded</Alert> : (
            <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined" sx={{ mb: 3 }}>
              <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: '#FBF8F5' }}>
                  {['Diagnosis', 'Description', 'Date', 'Status'].map(h => <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11 }}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {(healthConditions ?? []).map((c, i: number) => (
                    <TableRow key={i}>
                      <TableCell sx={{ fontSize: 11, fontWeight: 600 }}>{c.healthConditionDiagnosis}</TableCell>
                      <TableCell sx={{ fontSize: 11 }}>{c.healthConditionDescription ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 10 }}>{fmtDate(c.diagnosisDate)}</TableCell>
                      <TableCell><Chip label={c.status} size="small" sx={{ fontSize: 9, height: 18, textTransform: 'capitalize',
                        bgcolor: c.status === 'active' ? '#FDECEA' : c.status === 'resolved' ? '#E8F5E9' : '#eee',
                        color: c.status === 'active' ? '#D32F2F' : c.status === 'resolved' ? '#2E7D32' : '#999' }} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Support Persons */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <PeopleIcon sx={{ color: '#327C8D' }} /> Support Persons ({(supportPersons ?? []).length})
          </Typography>
          <Grid container spacing={1.5}>
            {(supportPersons ?? []).map((sp, i: number) => (
              <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="body2" fontWeight={700}>{sp.name}</Typography>
                  <Typography variant="caption" color="text.secondary">{sp.relationship}</Typography>
                  {sp.phone?.number && <Typography variant="caption" display="block">{sp.phone.countryCode} {sp.phone.number}</Typography>}
                  {sp.email && <Typography variant="caption" display="block">{sp.email}</Typography>}
                  <Chip label={sp.shareConsent ?? 'No Consent'} size="small" sx={{ mt: 0.5, fontSize: 9, height: 18,
                    bgcolor: sp.shareConsent === 'Full Consent' ? '#E8F5E9' : sp.shareConsent === 'Partial Consent' ? '#FFF3E0' : '#FDECEA',
                    color: sp.shareConsent === 'Full Consent' ? '#2E7D32' : sp.shareConsent === 'Partial Consent' ? '#b8621a' : '#D32F2F' }} />
                </Paper>
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {/* ══════ VITALS — Dropdown + Graph + Values ══════ */}
      {tab === 'vitals' && (() => {
        // Build metric options from vitals + mood + rating categories
        const metricOptions: { key: string; label: string; color: string; data: { date: string; value: number; label?: string }[] }[] = [
          { key: 'mood', label: 'Mood', color: '#327C8D',
            data: (allMoods ?? summary?.recentMoodEntries ?? []).map((m) => ({ date: m.recordedAt ?? '', value: m.mood, label: MOOD_LABELS[m.mood] })).reverse() },
          { key: 'weight', label: 'Weight (kg)', color: '#b8621a',
            data: (weightHistory ?? []).map((r) => ({ date: r.recordedAt ?? '', value: r.value })).reverse() },
          { key: 'heartRate', label: 'Heart Rate (BPM)', color: '#D32F2F',
            data: (hrHistory ?? []).map((r) => ({ date: r.recordedAt ?? '', value: r.value })).reverse() },
          { key: 'bpSystolic', label: 'Blood Pressure — Systolic', color: '#1565C0',
            data: (bpHistory ?? []).map((r) => ({ date: r.recordedAt ?? '', value: r.systolic })).reverse() },
          { key: 'bpDiastolic', label: 'Blood Pressure — Diastolic', color: '#7B1FA2',
            data: (bpHistory ?? []).map((r) => ({ date: r.recordedAt ?? '', value: r.diastolic })).reverse() },
          { key: 'bloodSugar', label: 'Blood Sugar', color: '#E65100',
            data: (bsHistory ?? []).map((r) => ({ date: r.recordedAt ?? '', value: r.value, label: r.mealTime?.replace('_', ' ') })).reverse() },
          { key: 'temperature', label: 'Temperature (°C)', color: '#D32F2F',
            data: (tempHistory ?? []).map((r) => ({ date: r.recordedAt ?? '', value: r.value })).reverse() },
          { key: 'waist', label: 'Waist Circumference (cm)', color: '#3D484B',
            data: (abdomHistory ?? []).map((r) => ({ date: r.recordedAt ?? '', value: r.value })).reverse() },
          // Add rating categories as metrics
          ...(ratingCategories ?? []).map((cat) => ({
            key: `rating_${cat._id}`, label: cat.name ?? 'Custom Rating', color: '#2E7D32',
            data: (ratingEntries ?? [])
              .filter((re) => re.categoryId === cat._id)
              .flatMap((re) => (re.ratings ?? []).map((r) => ({ date: r.createdAt ?? '', value: r.rating, label: r.note })))
              .reverse(),
          })),
        ];

        const selected = metricOptions.find(m => m.key === selectedMetric) ?? metricOptions[0];
        const points = selected?.data ?? [];
        const hasData = points.length > 0;

        // SVG graph dimensions
        const W = 600, H = 200, PAD = 40;
        const maxVal = hasData ? Math.max(...points.map(p => p.value), 1) : 10;
        const minVal = hasData ? Math.min(...points.map(p => p.value), 0) : 0;
        const range = maxVal - minVal || 1;

        return (
          <Box>
            {/* Dropdown selector */}
            <Box sx={{ display: 'flex', gap: 2, mb: 3, alignItems: 'center' }}>
              <FormControl size="small" sx={{ minWidth: 250 }}>
                <InputLabel>Select Metric</InputLabel>
                <Select value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)} label="Select Metric">
                  {metricOptions.map(m => (
                    <MenuItem key={m.key} value={m.key}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: m.color }} />
                        {m.label} ({m.data.length})
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary">
                {points.length} readings
              </Typography>
            </Box>

            {/* Graph + Values side by side */}
            <Grid container spacing={2}>
              {/* Graph */}
              <Grid size={{ xs: 12, md: 7 }}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1, color: selected.color }}>
                    {selected.label}
                  </Typography>
                  {!hasData ? (
                    <Box sx={{ py: 4, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">No data recorded in app</Typography>
                    </Box>
                  ) : (
                    <svg width="100%" viewBox={`0 0 ${W} ${H + 20}`} style={{ display: 'block' }}>
                      {/* Grid lines */}
                      {[0, 0.25, 0.5, 0.75, 1].map(pct => {
                        const y = PAD + (H - PAD * 2) * (1 - pct);
                        const val = minVal + range * pct;
                        return (
                          <g key={pct}>
                            <line x1={PAD} y1={y} x2={W - 10} y2={y} stroke="#eee" strokeWidth={1} />
                            <text x={PAD - 5} y={y + 4} textAnchor="end" fontSize="9" fill="#999">{Math.round(val)}</text>
                          </g>
                        );
                      })}
                      {/* Line */}
                      {points.length > 1 && (
                        <polyline
                          fill="none" stroke={selected.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
                          points={points.map((p, i) => {
                            const x = PAD + (i / (points.length - 1)) * (W - PAD - 10);
                            const y = PAD + (H - PAD * 2) * (1 - (p.value - minVal) / range);
                            return `${x},${y}`;
                          }).join(' ')}
                        />
                      )}
                      {/* Area fill */}
                      {points.length > 1 && (
                        <polygon
                          fill={selected.color} opacity={0.1}
                          points={[
                            `${PAD},${H - PAD}`,
                            ...points.map((p, i) => {
                              const x = PAD + (i / (points.length - 1)) * (W - PAD - 10);
                              const y = PAD + (H - PAD * 2) * (1 - (p.value - minVal) / range);
                              return `${x},${y}`;
                            }),
                            `${PAD + ((points.length - 1) / (points.length - 1)) * (W - PAD - 10)},${H - PAD}`,
                          ].join(' ')}
                        />
                      )}
                      {/* Data points */}
                      {points.map((p, i) => {
                        const x = points.length > 1 ? PAD + (i / (points.length - 1)) * (W - PAD - 10) : W / 2;
                        const y = PAD + (H - PAD * 2) * (1 - (p.value - minVal) / range);
                        return (
                          <g key={i}>
                            <circle cx={x} cy={y} r={4} fill={selected.color} stroke="#fff" strokeWidth={2} />
                            <text x={x} y={y - 10} textAnchor="middle" fontSize="9" fontWeight="700" fill={selected.color}>{p.value}</text>
                          </g>
                        );
                      })}
                      {/* X-axis date labels */}
                      {points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 6)) === 0 || i === points.length - 1).map((p, _, _arr) => {
                        const idx = points.indexOf(p);
                        const x = points.length > 1 ? PAD + (idx / (points.length - 1)) * (W - PAD - 10) : W / 2;
                        return (
                          <text key={idx} x={x} y={H + 10} textAnchor="middle" fontSize="8" fill="#999">
                            {new Date(p.date).toLocaleDateString('en-AU', { day: '2-digit', month: 'short' })}
                          </text>
                        );
                      })}
                    </svg>
                  )}
                </Paper>
              </Grid>

              {/* Values table */}
              <Grid size={{ xs: 12, md: 5 }}>
                <Paper variant="outlined" sx={{ p: 2, maxHeight: 300, overflowY: 'auto' }}>
                  <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>Values</Typography>
                  {!hasData ? (
                    <Typography variant="body2" color="text.secondary">No data</Typography>
                  ) : (
                    <Table size="small">
                      <TableHead><TableRow>
                        <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>Date</TableCell>
                        <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>Value</TableCell>
                        {points.some(p => p.label) && <TableCell sx={{ fontWeight: 700, fontSize: 10 }}>Note</TableCell>}
                      </TableRow></TableHead>
                      <TableBody>
                        {[...points].reverse().map((p, i) => (
                          <TableRow key={i}>
                            <TableCell sx={{ fontSize: 10 }}>{fmtDateTime(p.date)}</TableCell>
                            <TableCell sx={{ fontSize: 11, fontWeight: 700, color: selected.color }}>{p.value}</TableCell>
                            {points.some(pt => pt.label) && <TableCell sx={{ fontSize: 10 }}>{p.label ?? '—'}</TableCell>}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </Paper>
              </Grid>
            </Grid>
          </Box>
        );
      })()}

      {/* ══════ MEDICATIONS ══════ */}
      {tab === 'medications' && (
        <Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <MedicationIcon sx={{ color: '#327C8D' }} /> App-Reported Medications
          </Typography>
          {(allMeds ?? []).length === 0 ? <Alert severity="info">No medications recorded in app</Alert> : (
            <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
              <Table size="small">
                <TableHead><TableRow sx={{ bgcolor: '#FBF8F5' }}>
                  {['Medication', 'Dosage', 'Frequency', 'Route', 'Status', 'Updated'].map(h => <TableCell key={h} sx={{ fontWeight: 700, fontSize: 11 }}>{h}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {(allMeds ?? []).map((m, i: number) => (
                    <TableRow key={i}>
                      <TableCell sx={{ fontSize: 11, fontWeight: 600 }}>{m.medicationName}</TableCell>
                      <TableCell sx={{ fontSize: 11 }}>{m.dosage ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 11 }}>{m.frequency ?? '—'}</TableCell>
                      <TableCell sx={{ fontSize: 11 }}>{m.route ?? '—'}</TableCell>
                      <TableCell><Chip label={m.isActive ? 'Active' : 'Inactive'} size="small" sx={{ fontSize: 9, height: 18,
                        bgcolor: m.isActive ? '#E8F5E9' : '#eee', color: m.isActive ? '#2E7D32' : '#999' }} /></TableCell>
                      <TableCell sx={{ fontSize: 10 }}>{fmtDate(m.updatedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* App-reported allergies */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mt: 3, mb: 1, color: '#D32F2F', display: 'flex', alignItems: 'center', gap: 1 }}>
            <WarningAmberIcon /> Allergies (from app)
          </Typography>
          {(summary.activeAllergies ?? []).length === 0 ? <Alert severity="info">No allergies in app</Alert> : (
            <Box>
              {(summary.activeAllergies ?? []).map((a, i: number) => (
                <Paper key={i} variant="outlined" sx={{ p: 1.5, mb: 1, bgcolor: '#FFF5F5', borderColor: '#FFCDD2' }}>
                  <Typography variant="body2"><strong>Anaphylaxis:</strong> {a.Anaphylaxis ?? '—'}</Typography>
                  <Typography variant="body2"><strong>ADR:</strong> {a.AllergicReactionADR ?? '—'}</Typography>
                </Paper>
              ))}
            </Box>
          )}
        </Box>
      )}

      {/* ══════ MOOD & JOURNAL ══════ */}
      {tab === 'mood-journal' && (
        <Box>
          {/* Journal entries only — mood is now in Vitals tab graph */}
          <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
            <MenuBookIcon sx={{ color: '#7B1FA2' }} /> Journal Entries
          </Typography>
          {(journals ?? []).length === 0 ? <Alert severity="info">No journal entries</Alert> : (
            <Box>
              {(journals ?? []).map((j, i: number) => (
                <Paper key={i} variant="outlined" sx={{ p: 2, mb: 1.5, borderLeft: `3px solid ${j.isPrivate ? '#7B1FA2' : '#327C8D'}` }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2" fontWeight={700}>{j.title}</Typography>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                      {j.isPrivate && <Chip label="Private" size="small" sx={{ fontSize: 8, height: 16, bgcolor: '#F3E5F5', color: '#7B1FA2' }} />}
                      <Typography variant="caption" color="text.disabled" sx={{ fontSize: 9 }}>{fmtDateTime(j.createdAt)}</Typography>
                    </Box>
                  </Box>
                  <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>
                    {(j.content ?? '').substring(0, 300)}{(j.content?.length ?? 0) > 300 ? '...' : ''}
                  </Typography>
                  {(j.attachments ?? []).length > 0 && (
                    <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                      {(j.attachments ?? []).map((a, ai: number) => (
                        <Chip key={ai} label={a.fileName} size="small" variant="outlined" sx={{ fontSize: 9, height: 18 }} />
                      ))}
                    </Box>
                  )}
                </Paper>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ── Helper Components ──

interface VitalCardProps { icon: React.ReactNode; color: string; label: string; value: string | null; sub?: string; date?: string; status?: string; }
function VitalCard({ icon, color, label, value, sub, date, status }: VitalCardProps) {
  return (
    <Card variant="outlined" sx={{ height: '100%', '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.08)' } }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ color, mb: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {icon}
          {status && <Chip label={status} size="small" sx={{ fontSize: 8, height: 14,
            bgcolor: status === 'Normal' ? '#E8F5E9' : status === 'High' ? '#FDECEA' : '#FFF3E0',
            color: status === 'Normal' ? '#2E7D32' : status === 'High' ? '#D32F2F' : '#b8621a' }} />}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{label}</Typography>
        {value ? (
          <>
            <Typography variant="body1" fontWeight={700} sx={{ color }}>{value}</Typography>
            {sub && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{sub}</Typography>}
            {date && <Typography variant="caption" color="text.disabled" display="block" sx={{ fontSize: 9 }}>{fmtDate(date)}</Typography>}
          </>
        ) : (
          <Typography variant="body2" color="text.disabled">No data</Typography>
        )}
      </CardContent>
    </Card>
  );
}

// ── Medical range status helpers ──
function hrStatus(bpm: number): string { return bpm < 60 ? 'Low' : bpm > 100 ? 'High' : 'Normal'; }
function bpStatus(sys: number): string { return sys > 180 ? 'Critical' : sys > 130 ? 'High' : sys > 120 ? 'Elevated' : 'Normal'; }

export default TrackingTab;

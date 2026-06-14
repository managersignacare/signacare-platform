import AddIcon from '@mui/icons-material/Add';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import PersonIcon from '@mui/icons-material/Person';
import PrintIcon from '@mui/icons-material/Print';
import ScienceIcon from '@mui/icons-material/Science';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import {
    Alert, Autocomplete, Box, Button, Card, Chip, CircularProgress, Dialog, DialogActions,
    DialogContent, DialogTitle, Divider, FormControl, Grid, IconButton, InputLabel, MenuItem, Select,
    Snackbar, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
    TextField, Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import {
  AU_INVESTIGATION_TYPES,
  type PathologyOrderCreateDTO,
  type PathologyOrderResponse,
  type PatientResponse,
} from '@signacare/shared';
import { apiClient } from '../../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../../shared/store/authStore';
import { unstyledButtonSx } from '../../../../../shared/styles/unstyledButton';
import { printContent } from '../../../../../shared/utils/printContent';
import { sharedClinicProfileKeys } from '../../../../../shared/queryKeys';
import { pathologyKeys, patientsKeys } from '../../../queryKeys';

type OrderUrgency = 'routine' | 'urgent' | 'stat';

type InvestigationOption = {
  slug: string;
  label: string;
  requiresFasting: boolean;
  urgencyDefault: OrderUrgency;
};

function isOrderUrgency(value: unknown): value is OrderUrgency {
  return value === 'routine' || value === 'urgent' || value === 'stat';
}

const INVESTIGATION_OPTIONS: InvestigationOption[] = AU_INVESTIGATION_TYPES.map((row) => {
  const metadata = row.metadata as Record<string, unknown>;
  const rawUrgency = metadata['urgencyDefault'];
  const urgencyDefault: OrderUrgency = isOrderUrgency(rawUrgency)
    ? rawUrgency
    : 'routine';
  return {
    slug: row.slug,
    label: row.displayName,
    requiresFasting: metadata['requiresFasting'] === true,
    urgencyDefault,
  };
});

const PATHOLOGY_TEST_OPTIONS = INVESTIGATION_OPTIONS.filter((opt) => {
  const row = AU_INVESTIGATION_TYPES.find((item) => item.slug === opt.slug);
  const metadata = row?.metadata as Record<string, unknown> | undefined;
  return metadata?.['category'] === 'pathology';
});

const INVESTIGATION_TYPES = Array.from(
  new Set([...INVESTIGATION_OPTIONS.map((opt) => opt.label), 'Other']),
);

type TestPack = {
  id: string;
  label: string;
  panelName: string;
  tests: string[];
};

const TEST_PACKS: TestPack[] = [
  {
    id: 'metabolic-monitoring',
    label: 'Metabolic Monitoring Pack',
    panelName: 'Metabolic Monitoring Panel',
    tests: [
      'Full Blood Count (FBC)',
      'Urea, Electrolytes & Creatinine (UEC)',
      'Liver Function Tests (LFT)',
      'Thyroid Function Tests (TFT)',
      'HbA1c (Glycated Haemoglobin)',
      'Fasting Glucose & Lipid Panel',
      'Serum Prolactin',
    ],
  },
  {
    id: 'clozapine-monitoring',
    label: 'Clozapine Monitoring Pack',
    panelName: 'Clozapine Monitoring Panel',
    tests: [
      'Full Blood Count (FBC)',
      'Clozapine Level + WCC/ANC',
      'ESR & CRP',
      'High-Sensitivity Troponin',
      'Urea, Electrolytes & Creatinine (UEC)',
      'Liver Function Tests (LFT)',
    ],
  },
  {
    id: 'lithium-monitoring',
    label: 'Lithium Monitoring Pack',
    panelName: 'Lithium Monitoring Panel',
    tests: [
      'Lithium Level (Therapeutic Drug Monitoring)',
      'Urea, Electrolytes & Creatinine (UEC)',
      'Thyroid Function Tests (TFT)',
      'Full Blood Count (FBC)',
      'Fasting Glucose & Lipid Panel',
    ],
  },
  {
    id: 'first-episode-baseline',
    label: 'First Episode Baseline Pack',
    panelName: 'First Episode Psychosis Baseline',
    tests: [
      'Full Blood Count (FBC)',
      'Urea, Electrolytes & Creatinine (UEC)',
      'Liver Function Tests (LFT)',
      'Thyroid Function Tests (TFT)',
      'HbA1c (Glycated Haemoglobin)',
      'Fasting Glucose & Lipid Panel',
      'Vitamin B12 & Folate',
      'Iron Studies & Ferritin',
      'ESR & CRP',
      'Drug & Alcohol Urine Screen',
      'Syphilis Serology',
      'HIV Serology',
      'Hepatitis B Serology',
      'Hepatitis C Serology',
    ],
  },
];

interface PathologyReport {
  id: string; filename: string; label: string; mimetype: string; filesize: number; createdAt: string; downloadUrl?: string;
}
interface TeamAssignmentMember {
  staffId?: string;
  staffName?: string;
  roleName?: string;
}
interface TeamAssignment {
  patientId?: string;
  primaryClinicianId?: string;
  clinicianName?: string;
  keyWorkerName?: string;
  mdt?: TeamAssignmentMember[];
}
interface TeamAssignmentsResponse {
  assignments?: TeamAssignment[];
}
interface UploadPathologyResponse {
  message?: string;
}

interface ClinicProfileSummary {
  name?: string;
  phone?: string;
  email?: string;
  addressStreet?: string;
  addressSuburb?: string;
  addressState?: string;
  addressPostcode?: string;
}

function formatPatientAddress(patient: PatientResponse | undefined): string {
  if (!patient) return 'Not recorded';
  const parts = [
    patient.addressStreet,
    patient.addressSuburb,
    patient.addressState,
    patient.addressPostcode,
  ].filter((part) => !!part && part.trim().length > 0);
  return parts.length > 0 ? parts.join(', ') : 'Not recorded';
}

function formatClinicAddress(clinic: ClinicProfileSummary | undefined): string {
  if (!clinic) return 'Not recorded';
  const parts = [
    clinic.addressStreet,
    clinic.addressSuburb,
    clinic.addressState,
    clinic.addressPostcode,
  ].filter((part) => !!part && part.trim().length > 0);
  return parts.length > 0 ? parts.join(', ') : 'Not recorded';
}

function formatUrgencyLabel(urgency: OrderUrgency): string {
  return urgency.charAt(0).toUpperCase() + urgency.slice(1);
}

function getErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const withResponse = err as { response?: { data?: { error?: unknown } } };
    const apiError = withResponse.response?.data?.error;
    if (typeof apiError === 'string' && apiError.trim()) return apiError;
    const withMessage = err as { message?: unknown };
    if (typeof withMessage.message === 'string' && withMessage.message.trim()) return withMessage.message;
  }
  return 'Unknown error';
}

interface PathologyTabProps { patientId: string }
export function PathologyTab({ patientId }: PathologyTabProps) {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [addOpen, setAddOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [panelName, setPanelName] = useState('Pathology Request');
  const [orderUrgency, setOrderUrgency] = useState<OrderUrgency>('routine');
  const [orderFasting, setOrderFasting] = useState(false);
  const [copyToGp, setCopyToGp] = useState(false);
  const [orderNotes, setOrderNotes] = useState('');
  const [selectedTestNames, setSelectedTestNames] = useState<string[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [investigationType, setInvestigationType] = useState(INVESTIGATION_TYPES[0]);
  const [reportDate, setReportDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [successMsg, setSuccessMsg] = useState('');
  const [additionalAssignees, setAdditionalAssignees] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: patient } = useQuery({
    queryKey: patientsKeys.detail(patientId),
    queryFn: () => apiClient.get<PatientResponse>(`patients/${patientId}`),
    enabled: !!patientId,
    staleTime: 60_000,
  });

  const { data: clinicProfile } = useQuery({
    queryKey: sharedClinicProfileKeys.pathologyRequestPrint(),
    queryFn: () => apiClient.get<ClinicProfileSummary>('clinics/me'),
    enabled: !!user?.clinicId,
    staleTime: 5 * 60_000,
  });

  const {
    data: pathologyOrders,
    isLoading: ordersLoading,
    isError: ordersError,
  } = useQuery({
    queryKey: pathologyKeys.orders(patientId),
    queryFn: () => apiClient.get<PathologyOrderResponse[]>(`pathology/patients/${patientId}/orders`),
    enabled: !!patientId,
    staleTime: 30_000,
  });

  const { data: staffList } = useQuery({
    queryKey: patientsKeys.staffLookup(),
    queryFn: () => apiClient.get<{ id: string; givenName: string; familyName: string }[]>('staff/lookup'),
    staleTime: 5 * 60_000,
  });

  const staffNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const staff of staffList ?? []) {
      map.set(staff.id, `${staff.givenName} ${staff.familyName}`.trim());
    }
    return map;
  }, [staffList]);

  const pathologyTestOptions = useMemo(
    () => PATHOLOGY_TEST_OPTIONS.map((opt) => opt.label),
    [],
  );

  function upsertTests(nextTests: string[]): void {
    setSelectedTestNames((prev) => Array.from(new Set([...prev, ...nextTests])));
  }

  function applyPack(packId: string): void {
    const pack = TEST_PACKS.find((item) => item.id === packId);
    if (!pack) return;
    setActivePackId(packId);
    setPanelName(pack.panelName);
    upsertTests(pack.tests);

    const anyFasting = pack.tests.some((testName) =>
      PATHOLOGY_TEST_OPTIONS.find((opt) => opt.label === testName)?.requiresFasting === true,
    );
    if (anyFasting) setOrderFasting(true);
  }

  function buildPathologyPrintBody(order: PathologyOrderResponse): string {
    const fallbackRequester = `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim();
    const requesterName = staffNameById.get(order.orderedById)
      ?? (fallbackRequester || `Staff ${order.orderedById.slice(0, 8)}`);
    const requesterRole = user?.role ? String(user.role) : 'Not recorded';
    const patientName = patient
      ? `${patient.givenName} ${patient.familyName}`.trim()
      : order.patientId;
    const patientDob = patient?.dateOfBirth
      ? new Date(patient.dateOfBirth).toLocaleDateString('en-AU')
      : 'Not recorded';
    const medicare = patient?.medicareNumber
      ? `${patient.medicareNumber}${patient.medicareIrn ? ` / IRN ${patient.medicareIrn}` : ''}`
      : 'Not recorded';
    const requestedTests = (order.tests ?? []).map((test) => `- ${test}`).join('\n');

    return [
      'PATHOLOGY REQUEST FORM',
      '',
      'Requesting Clinician',
      `- Name: ${requesterName || 'Not recorded'}`,
      `- Role: ${requesterRole}`,
      '',
      'Clinic Details',
      `- Clinic: ${clinicProfile?.name ?? 'Not recorded'}`,
      `- Phone: ${clinicProfile?.phone ?? 'Not recorded'}`,
      `- Email: ${clinicProfile?.email ?? 'Not recorded'}`,
      `- Address: ${formatClinicAddress(clinicProfile)}`,
      '',
      'Patient Details',
      `- Name: ${patientName}`,
      `- DOB: ${patientDob}`,
      `- Medicare: ${medicare}`,
      `- Address: ${formatPatientAddress(patient)}`,
      '',
      'Order Details',
      `- Order Number: ${order.orderNumber}`,
      `- Panel: ${order.panelName}`,
      `- Urgency: ${formatUrgencyLabel(order.urgency)}`,
      `- Fasting Required: ${order.fasting ? 'Yes' : 'No'}`,
      `- Copy to GP: ${order.copyToGp ? 'Yes' : 'No'}`,
      `- Created: ${new Date(order.createdAt).toLocaleString('en-AU')}`,
      '',
      'Tests Requested',
      requestedTests || '- None',
      '',
      'Clinical Notes',
      order.clinicalNotes?.trim() ? order.clinicalNotes : 'Not recorded',
    ].join('\n');
  }

  function printPathologyOrder(order: PathologyOrderResponse): void {
    printContent({
      title: `Pathology Request — ${order.orderNumber}`,
      subtitle: `${patient?.givenName ?? ''} ${patient?.familyName ?? ''}`.trim(),
      body: buildPathologyPrintBody(order),
    });
  }

  // Fetch MDT members for this specific patient (from episodes + staff role assignments)
  const { data: mdtData } = useQuery({
    queryKey: pathologyKeys.mdtByPatient(patientId),
    queryFn: async () => {
      // Get team assignments for this patient
      const taResp = await apiClient.get<TeamAssignmentsResponse>('patients/team-assignments').catch((): TeamAssignmentsResponse => ({ assignments: [] }));
      const assignments = taResp.assignments ?? [];
      // Find this patient — camelCaseResponse middleware guarantees camelCase keys
      const assignment = assignments.find((a) => a.patientId === patientId);
      if (!assignment) return { members: [], assignment: null };

      const members: { staffId: string; staffName: string; roleName: string }[] = [];
      // Primary clinician
      if (assignment.primaryClinicianId && assignment.clinicianName) {
        members.push({ staffId: assignment.primaryClinicianId, staffName: assignment.clinicianName, roleName: 'Key Clinician' });
      }
      // MDT roles
      for (const m of assignment.mdt ?? []) {
        if (m.staffId && m.staffName) members.push({ staffId: m.staffId, staffName: m.staffName, roleName: m.roleName ?? 'MDT Member' });
      }
      // Key worker
      if (assignment.keyWorkerName) {
        members.push({ staffId: '', staffName: assignment.keyWorkerName, roleName: 'Key Worker' });
      }
      return { members, assignment };
    },
    enabled: !!patientId,
    staleTime: 60_000,
  });
  const mdtMembers = mdtData?.members ?? [];

  const { data: reports, isLoading } = useQuery({
    queryKey: pathologyKeys.byPatient(patientId),
    queryFn: () => apiClient.get<{ reports: PathologyReport[] }>(`patients/${patientId}/pathology`).then(r => r.reports),
    enabled: !!patientId,
  });

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!selectedFile) return;
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('investigationType', investigationType);
      formData.append('reportDate', reportDate);
      if (notes.trim()) formData.append('notes', notes.trim());
      if (additionalAssignees.length) formData.append('additionalAssignees', JSON.stringify(additionalAssignees));
      return apiClient.instance.post<UploadPathologyResponse>(`patients/${patientId}/pathology`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then(r => r.data);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: pathologyKeys.byPatient(patientId) });
      // @catalogued: BUG-241 (Wave B-1) — no tasksRoot helper on patientsKeys; invalidate all tasks
      qc.invalidateQueries({ queryKey: patientsKeys.tasksAll() });
      setAddOpen(false);
      setSelectedFile(null);
      setNotes('');
      setSuccessMsg(result?.message || 'Report uploaded successfully.');
    },
    onError: (err: unknown) => alert(`Upload failed: ${getErrorMessage(err)}`),
  });

  const createOrderMut = useMutation({
    mutationFn: (payload: PathologyOrderCreateDTO) =>
      apiClient.post<PathologyOrderResponse>('pathology/orders', payload),
    onSuccess: (createdOrder) => {
      qc.invalidateQueries({ queryKey: pathologyKeys.orders(patientId) });
      setSuccessMsg(`Pathology request ${createdOrder.orderNumber} created.`);
      setRequestOpen(false);
      printPathologyOrder(createdOrder);
      setPanelName('Pathology Request');
      setOrderUrgency('routine');
      setOrderFasting(false);
      setCopyToGp(false);
      setOrderNotes('');
      setSelectedTestNames([]);
      setActivePackId(null);
    },
    onError: (err: unknown) => {
      alert(`Pathology request failed: ${getErrorMessage(err)}`);
    },
  });

  const selectedOrderTests = selectedTestNames
    .map((name) => PATHOLOGY_TEST_OPTIONS.find((opt) => opt.label === name))
    .filter((opt): opt is InvestigationOption => !!opt);

  function submitPathologyRequest(): void {
    const tests = Array.from(new Set(selectedTestNames)).filter((test) => test.trim().length > 0);
    if (tests.length === 0) {
      alert('Select at least one pathology test before creating the request.');
      return;
    }
    const payload: PathologyOrderCreateDTO = {
      patientId,
      panelName: panelName.trim() || 'Pathology Request',
      tests,
      urgency: orderUrgency,
      clinicalNotes: orderNotes.trim() || undefined,
      fasting: orderFasting,
      copyToGp,
    };
    createOrderMut.mutate(payload);
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif">Pathology & Investigations</Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            startIcon={<ScienceIcon />}
            variant="contained"
            size="small"
            onClick={() => setRequestOpen(true)}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#286575' } }}
          >
            Request Tests
          </Button>
          <Button startIcon={<AddIcon />} variant="contained" size="small" onClick={() => setAddOpen(true)}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>Upload Report</Button>
        </Box>
      </Box>

      <Card variant="outlined" sx={{ mb: 2, p: 2, borderColor: '#D7E7EE' }}>
        <Typography variant="subtitle1" fontWeight={700} sx={{ color: '#327C8D', mb: 1 }}>
          Pathology Requests
        </Typography>
        {ordersLoading ? (
          <CircularProgress role="progressbar" aria-label="Loading" size={22} />
        ) : ordersError ? (
          <Alert severity="error">Failed to load pathology requests. Refresh to retry.</Alert>
        ) : !(pathologyOrders && pathologyOrders.length > 0) ? (
          <Alert severity="info">No pathology requests created yet for this patient.</Alert>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                {['Order #', 'Panel', 'Tests', 'Urgency', 'Status', 'Requested', 'Actions'].map((column) => (
                  <TableCell key={column} sx={{ fontWeight: 600, fontSize: 12 }}>{column}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {pathologyOrders.map((order) => (
                <TableRow key={order.id} hover>
                  <TableCell>{order.orderNumber}</TableCell>
                  <TableCell>{order.panelName}</TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{ display: 'block', maxWidth: 340 }}>
                      {order.tests.join(', ')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      label={formatUrgencyLabel(order.urgency)}
                      color={order.urgency === 'stat' ? 'error' : order.urgency === 'urgent' ? 'warning' : 'default'}
                    />
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={order.status} variant="outlined" sx={{ textTransform: 'capitalize' }} />
                  </TableCell>
                  <TableCell>{new Date(order.createdAt).toLocaleDateString('en-AU')}</TableCell>
                  <TableCell>
                    <Tooltip title="Print request">
                      <span>
                        <IconButton size="small" onClick={() => printPathologyOrder(order)}>
                          <PrintIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {isLoading ? <CircularProgress role="progressbar" aria-label="Loading" size={24} /> : !reports?.length ? (
        <Alert severity="info">No pathology reports uploaded. Click &quot;Upload Report&quot; to add one.</Alert>
      ) : (
        <TableContainer role="region" aria-label="Data table" component={Card} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                {['Investigation', 'Date', 'File', ''].map(c => (
                  <TableCell key={c} sx={{ fontWeight: 600, fontSize: 12 }}>{c}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {reports.map(r => (
                <TableRow key={r.id} hover>
                  <TableCell><Chip label={r.label.replace('Pathology: ', '')} size="small" sx={{ fontSize: 11 }} /></TableCell>
                  <TableCell>{new Date(r.createdAt).toLocaleDateString('en-AU')}</TableCell>
                  <TableCell>
                    <Box
                      role="button"
                      tabIndex={0}
                      aria-label={`Download pathology report ${r.filename}`}
                      onClick={() => { const url = r.downloadUrl; if (url) window.open(url, '_blank'); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const url = r.downloadUrl; if (url) window.open(url, '_blank'); } }}
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, cursor: 'pointer', borderRadius: 0.5, '&:hover': { color: '#b8621a' }, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2 } }}>
                      <AttachFileIcon sx={{ fontSize: 16, color: '#b8621a' }} />
                      <Typography variant="body2" sx={{ textDecoration: 'underline', color: '#327C8D' }}>{r.filename}</Typography>
                    </Box>
                  </TableCell>
                  <TableCell>
                    <Chip icon={<TaskAltIcon sx={{ fontSize: 14 }} />} label="Review task sent" size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Pathology Request Dialog */}
      <Dialog
        aria-labelledby="request-dialog-title"
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle id="request-dialog-title">Request Pathology Tests</DialogTitle>
        <Divider />
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <Card variant="outlined" sx={{ p: 1.5, bgcolor: '#F7FBFD' }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.75, color: '#327C8D' }}>
              Request Summary
            </Typography>
            <Grid container spacing={1.25}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Requesting Clinician</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {`${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim() || 'Not recorded'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.role ? String(user.role) : 'Role not recorded'}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Clinic</Typography>
                <Typography variant="body2" fontWeight={600}>{clinicProfile?.name ?? 'Not recorded'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatClinicAddress(clinicProfile)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <Typography variant="caption" color="text.secondary">Patient</Typography>
                <Typography variant="body2" fontWeight={600}>
                  {patient ? `${patient.givenName} ${patient.familyName}` : 'Loading...'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  DOB: {patient?.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString('en-AU') : 'Not recorded'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                  Medicare: {patient?.medicareNumber ? `${patient.medicareNumber}${patient.medicareIrn ? ` / IRN ${patient.medicareIrn}` : ''}` : 'Not recorded'}
                </Typography>
              </Grid>
            </Grid>
          </Card>

          <TextField
            size="small"
            label="Test Pack / Panel Name"
            value={panelName}
            onChange={(event) => setPanelName(event.target.value)}
            fullWidth
          />

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {TEST_PACKS.map((pack) => (
              <Chip
                key={pack.id}
                label={pack.label}
                onClick={() => applyPack(pack.id)}
                color={activePackId === pack.id ? 'primary' : 'default'}
                variant={activePackId === pack.id ? 'filled' : 'outlined'}
              />
            ))}
          </Box>

          <Autocomplete
            multiple
            options={pathologyTestOptions}
            value={selectedTestNames}
            onChange={(_, values) => {
              setSelectedTestNames(values);
              const hasFastingTest = values.some((testName) =>
                PATHOLOGY_TEST_OPTIONS.find((opt) => opt.label === testName)?.requiresFasting === true,
              );
              if (hasFastingTest) setOrderFasting(true);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label="Add Individual Tests"
                placeholder="Select one or more tests"
              />
            )}
          />

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {selectedOrderTests.map((test) => (
              <Chip
                key={test.slug}
                label={test.label}
                onDelete={() => {
                  setSelectedTestNames((prev) => prev.filter((name) => name !== test.label));
                }}
                size="small"
                variant="outlined"
              />
            ))}
            {selectedOrderTests.length === 0 && (
              <Typography variant="caption" color="text.secondary">No tests selected yet.</Typography>
            )}
          </Box>

          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Urgency</InputLabel>
                <Select
                  label="Urgency"
                  value={orderUrgency}
                  onChange={(event) => setOrderUrgency(event.target.value as OrderUrgency)}
                >
                  <MenuItem value="routine">Routine</MenuItem>
                  <MenuItem value="urgent">Urgent</MenuItem>
                  <MenuItem value="stat">STAT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Fasting Required</InputLabel>
                <Select
                  label="Fasting Required"
                  value={orderFasting ? 'yes' : 'no'}
                  onChange={(event) => setOrderFasting(event.target.value === 'yes')}
                >
                  <MenuItem value="no">No</MenuItem>
                  <MenuItem value="yes">Yes</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Copy to GP</InputLabel>
                <Select
                  label="Copy to GP"
                  value={copyToGp ? 'yes' : 'no'}
                  onChange={(event) => setCopyToGp(event.target.value === 'yes')}
                >
                  <MenuItem value="no">No</MenuItem>
                  <MenuItem value="yes">Yes</MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>

          <TextField
            label="Clinical Notes"
            size="small"
            fullWidth
            multiline
            rows={3}
            value={orderNotes}
            onChange={(event) => setOrderNotes(event.target.value)}
            placeholder="Reason for test request, working diagnosis, relevant medication context..."
          />
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setRequestOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={submitPathologyRequest}
            disabled={selectedTestNames.length === 0 || createOrderMut.isPending}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#286575' } }}
          >
            {createOrderMut.isPending ? (
              <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} />
            ) : (
              'Create & Print Request'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Upload Dialog */}
      <Dialog aria-labelledby="dialog-title" open={addOpen} onClose={() => setAddOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle id="dialog-title">Upload Pathology Report</DialogTitle>
        <Divider />
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 8 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Investigation Type</InputLabel>
                <Select value={investigationType} onChange={e => setInvestigationType(e.target.value)} label="Investigation Type">
                  {INVESTIGATION_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="Report Date" type="date" fullWidth size="small" value={reportDate} onChange={e => setReportDate(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            </Grid>
          </Grid>

          <Box
            sx={{ p: 2, border: '2px dashed', borderColor: selectedFile ? '#b8621a' : 'divider', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 1, '&:hover': { borderColor: '#b8621a', bgcolor: '#FFF8F2' } }}>
            <Box
              component="button"
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={selectedFile ? `Replace selected file ${selectedFile.name}` : 'Click to select PDF or image file'}
              sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1, ...unstyledButtonSx, '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: 2, borderRadius: 4 } }}>
              <CloudUploadIcon sx={{ color: '#b8621a' }} />
              <Typography variant="body2" color="text.secondary">
                {selectedFile ? selectedFile.name : 'Click to select PDF or image file'}
              </Typography>
            </Box>
            {selectedFile && (
              <IconButton size="small" aria-label="Remove selected file" onClick={() => setSelectedFile(null)} color="error"><DeleteIcon fontSize="small" /></IconButton>
            )}
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.tiff" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); e.target.value = '' }} />
          </Box>

          <TextField label="Notes (optional)" fullWidth size="small" multiline rows={2} value={notes} onChange={e => setNotes(e.target.value)} />

          {/* Task Assignment — MDT Members */}
          <Divider sx={{ my: 0.5 }} />
          <Typography variant="subtitle2" fontWeight={600} sx={{ color: '#327C8D' }}>
            <TaskAltIcon sx={{ fontSize: 16, verticalAlign: 'middle', mr: 0.5 }} />
            Review Task Assignment
          </Typography>

          {mdtMembers.length > 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Typography variant="caption" color="text.secondary">
                Tasks will be created for the following MDT members:
              </Typography>
              {mdtMembers.map(m => (
                <Box key={m.staffId} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.75, bgcolor: '#F0F7FA', borderRadius: 1, border: '1px solid #B3D9E8' }}>
                  <PersonIcon sx={{ fontSize: 16, color: '#327C8D' }} />
                  <Typography variant="body2" fontWeight={600} sx={{ flex: 1 }}>{m.staffName}</Typography>
                  <Chip label={m.roleName} size="small" sx={{ fontSize: 9, height: 18, bgcolor: '#E3F2FD', color: '#1565C0' }} />
                </Box>
              ))}
            </Box>
          ) : (
            <Alert severity="warning" sx={{ fontSize: 12 }}>
              No MDT members found for this patient&apos;s team. Tasks will be assigned to the key clinician if available.
            </Alert>
          )}

          {/* Additional assignees */}
          <Autocomplete
            multiple
            size="small"
            options={(staffList ?? []).filter(s => !mdtMembers.some(m => m.staffId === s.id))}
            getOptionLabel={s => `${s.givenName} ${s.familyName}`}
            value={(staffList ?? []).filter(s => additionalAssignees.includes(s.id))}
            onChange={(_, val) => setAdditionalAssignees(val.map(v => v.id))}
            renderInput={(params) => <TextField {...params} label="Additional Assignees (optional)" placeholder="Add more reviewers..." />}
            renderTags={(value, getTagProps) => value.map((s, i) => (
              <Chip {...getTagProps({ index: i })} key={s.id} label={`${s.givenName} ${s.familyName}`} size="small" sx={{ fontSize: 11 }} />
            ))}
          />
        </DialogContent>
        <Divider />
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => { setAddOpen(false); setAdditionalAssignees([]); }}>Cancel</Button>
          <Button variant="contained" onClick={() => uploadMut.mutate()} disabled={!selectedFile || uploadMut.isPending}
            sx={{ bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}>
            {uploadMut.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} sx={{ color: '#fff' }} /> : `Upload & Create ${mdtMembers.length + additionalAssignees.length} Task${mdtMembers.length + additionalAssignees.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Success message */}
      <Snackbar open={!!successMsg} autoHideDuration={5000} onClose={() => setSuccessMsg('')}
        message={successMsg} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
export default PathologyTab;

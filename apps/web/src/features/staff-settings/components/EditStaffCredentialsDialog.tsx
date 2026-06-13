import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import {
  Alert, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, FormControl, FormControlLabel, Grid, IconButton, InputLabel, MenuItem,
  Select, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ALL_SPECIALTIES, SPECIALTY_DISPLAY, isPrescriberSystemRole, type SpecialtyType } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';
import { useDisciplines } from '../hooks/useStaffSettings';
import { staffProfileKeys, staffPrescriberKeys, staffKeys } from '../queryKeys';
import {
  parseProviderNumbersFromQualifications,
  STAFF_PROVIDER_TYPES,
  STAFF_SYSTEM_ROLES,
  type StaffProviderNumber,
} from './staffFormModel';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
  /** When set, edits another staff member (admin). When null, edits self via /staff/me. */
  staffId?: string | null;
  /** Optional clinic override for superadmin editing non-session clinics. */
  clinicId?: string;
  /** Render as inline panel (no wrapping Dialog) — used in Settings > My Profile */
  inline?: boolean;
}

interface StaffSpecialtyEntry {
  code: SpecialtyType;
  isPrimary: boolean;
}

interface StaffData {
  id: string; givenName: string; familyName: string; email: string; role: string;
  discipline?: string; phoneMobile?: string; phoneWork?: string;
  ahpraNumber?: string; ahpraExpiry?: string; prescriberNumber?: string; providerNumber?: string;
  hpii?: string; qualifications?: string; specialisation?: string;
  settingsProfileTabVisible?: boolean;
  specialties?: StaffSpecialtyEntry[];
}

interface ErrorWithMessage {
  response?: {
    data?: {
      error?: string;
    };
  };
  message?: string;
}

function getErrorMessage(error: unknown, fallback: string): string {
  const maybe = error as ErrorWithMessage;
  return maybe.response?.data?.error ?? maybe.message ?? fallback;
}

export function EditStaffCredentialsDialog({ open, onClose, onSaved, staffId, clinicId, inline }: Props) {
  const qc = useQueryClient();
  const isSelf = !staffId;
  const endpoint = isSelf
    ? 'staff/me'
    : `staff/${staffId}${clinicId ? `?clinicId=${encodeURIComponent(clinicId)}` : ''}`;

  const { data, isLoading } = useQuery<StaffData>({
    queryKey: staffProfileKeys.detail(staffId),
    queryFn: () => apiClient.get<StaffData>(endpoint),
    enabled: open,
  });

  const [form, setForm] = useState<Partial<StaffData>>({});
  const [providerNumbers, setProviderNumbers] = useState<StaffProviderNumber[]>([]);
  const [isPrescriber, setIsPrescriber] = useState(false);
  const [phiProvider, setPhiProvider] = useState('');
  const [phiNumber, setPhiNumber] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { data: disciplineOptions } = useDisciplines(!isSelf ? clinicId : undefined);
  const roleGrantsPrescribing = isPrescriberSystemRole(form.role ?? null);

  useEffect(() => {
    if (!data) return;
    setForm({
      ...data,
      role: data.role ?? 'clinician',
      discipline: data.discipline ?? '',
      phoneMobile: data.phoneMobile ?? '',
      phoneWork: data.phoneWork ?? '',
      ahpraExpiry: data.ahpraExpiry ?? '',
    });
    setProviderNumbers(parseProviderNumbersFromQualifications(data.qualifications));
    setIsPrescriber(Boolean(data.prescriberNumber));
    setPhiProvider(data.specialisation ?? '');
    setPhiNumber(data.hpii ?? '');
  }, [data]);

  useEffect(() => {
    setIsPrescriber(roleGrantsPrescribing);
    if (!roleGrantsPrescribing) {
      setForm((prev) => ({ ...prev, prescriberNumber: '' }));
    }
  }, [roleGrantsPrescribing]);

  const saveMut = useMutation({
    mutationFn: (payload: Partial<StaffData>) =>
      apiClient.put<StaffData>(endpoint, payload),
    onSuccess: (updated) => {
      setSuccess('Staff credentials saved.');
      setError('');
      // Update the form immediately with the server response so saved values are visible
      if (updated) setForm(updated);
      qc.invalidateQueries({ queryKey: staffProfileKeys.all });
      qc.invalidateQueries({ queryKey: staffPrescriberKeys.all });
      qc.invalidateQueries({ queryKey: staffKeys.all });
      onSaved?.();
    },
    onError: (error: unknown) => {
      setError(getErrorMessage(error, 'Failed to save'));
      setSuccess('');
    },
  });

  const handleSave = () => {
    setError(''); setSuccess('');
    const payload: Partial<StaffData> & {
      isPrescriber?: boolean;
      providerNumbers?: StaffProviderNumber[];
      phiProvider?: string;
      phiNumber?: string;
    } = {
      givenName: form.givenName,
      familyName: form.familyName,
      email: form.email,
      discipline: form.discipline,
      phoneMobile: form.phoneMobile,
      phoneWork: form.phoneWork,
      ahpraNumber: form.ahpraNumber,
      ahpraExpiry: form.ahpraExpiry,
      prescriberNumber: form.prescriberNumber,
      providerNumber: form.providerNumber,
      hpii: form.hpii,
      qualifications: form.qualifications,
      specialisation: form.specialisation,
      specialties: form.specialties,
      providerNumbers: providerNumbers
        .map((row) => ({
          type: row.type.trim(),
          number: row.number.trim(),
          location: row.location.trim(),
        }))
        .filter((row) => row.number.length > 0),
      phiProvider: phiProvider.trim() || undefined,
      phiNumber: phiNumber.trim() || undefined,
    };
    if (!isSelf) {
      payload.role = form.role;
      payload.settingsProfileTabVisible = form.settingsProfileTabVisible;
      payload.isPrescriber = isPrescriber;
    }
    if (!isPrescriber) {
      payload.prescriberNumber = '';
    }
    saveMut.mutate(payload);
  };

  const set = (key: keyof StaffData, value: string) => {
    setForm(f => ({ ...f, [key]: value }));
  };

  const addProviderNumber = () => {
    setProviderNumbers((prev) => [...prev, { number: '', location: '', type: 'Medicare' }]);
  };

  const updateProviderNumber = (
    index: number,
    field: keyof StaffProviderNumber,
    value: string,
  ) => {
    setProviderNumbers((prev) => prev.map((row, rowIndex) => {
      if (rowIndex !== index) return row;
      return { ...row, [field]: value };
    }));
  };

  const removeProviderNumber = (index: number) => {
    setProviderNumbers((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  // ── Specialty enrolment helpers ───────────────────────────────────────────
  const specialties: StaffSpecialtyEntry[] = form.specialties ?? [];
  const specialtyCodes = new Set(specialties.map(s => s.code));

  const toggleSpecialty = (code: SpecialtyType) => {
    setForm(f => {
      const current = f.specialties ?? [];
      const exists = current.some(s => s.code === code);
      if (exists) {
        // Removing: if we remove the primary, promote the next one.
        const next = current.filter(s => s.code !== code);
        if (next.length > 0 && !next.some(s => s.isPrimary)) {
          next[0] = { ...next[0]!, isPrimary: true };
        }
        return { ...f, specialties: next };
      }
      // Adding: if nothing is primary yet, mark this new entry primary.
      const next = [...current, { code, isPrimary: current.length === 0 }];
      return { ...f, specialties: next };
    });
  };

  const setPrimarySpecialty = (code: SpecialtyType) => {
    setForm(f => {
      const current = f.specialties ?? [];
      return {
        ...f,
        specialties: current.map(s => ({ ...s, isPrimary: s.code === code })),
      };
    });
  };

  const content = (
    <Box>
      {isLoading && <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress size={28} /></Box>}
      {!isLoading && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, pt: inline ? 0 : 1 }}>
          {/* Personal Details */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 1, display: 'block' }}>
              Personal Details
            </Typography>
            {(disciplineOptions ?? []).length === 0 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                No active professional disciplines found for this clinic. Add disciplines in Staff Settings before editing staff.
              </Alert>
            )}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Given Name" fullWidth size="small" value={form.givenName ?? ''} onChange={e => set('givenName', e.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Family Name" fullWidth size="small" value={form.familyName ?? ''} onChange={e => set('familyName', e.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Discipline *</InputLabel>
                  <Select
                    value={form.discipline ?? ''}
                    onChange={(e) => set('discipline', e.target.value)}
                    label="Discipline *"
                  >
                    {(disciplineOptions ?? []).map((disciplineOption) => (
                      <MenuItem key={disciplineOption.id} value={disciplineOption.id}>
                        {disciplineOption.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Email" fullWidth size="small" value={form.email ?? ''} onChange={e => set('email', e.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField label="Phone" fullWidth size="small" value={form.phoneMobile ?? ''} onChange={e => set('phoneMobile', e.target.value)} placeholder="04xx xxx xxx" />
              </Grid>
              {!isSelf && (
                <Grid size={{ xs: 12, sm: 4 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel>System Role</InputLabel>
                    <Select
                      value={form.role ?? 'clinician'}
                      onChange={(e) => set('role', e.target.value)}
                      label="System Role"
                    >
                      {STAFF_SYSTEM_ROLES.map((systemRole) => (
                        <MenuItem key={systemRole} value={systemRole} sx={{ textTransform: 'capitalize' }}>
                          {systemRole}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>
              )}
              {!isSelf && (
                <Grid size={{ xs: 12 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={!!form.settingsProfileTabVisible}
                        onChange={(_, checked) =>
                          setForm((prev) => ({ ...prev, settingsProfileTabVisible: checked }))}
                        size="small"
                      />
                    }
                    label={<Typography variant="body2">Allow Settings -&gt; My Profile for this staff member</Typography>}
                  />
                </Grid>
              )}
            </Grid>
          </Box>

          <Divider />

          {/* AHPRA Registration */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 1, display: 'block' }}>
              AHPRA Registration
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="AHPRA Number" fullWidth size="small" value={form.ahpraNumber ?? ''} onChange={e => set('ahpraNumber', e.target.value)}
                  placeholder="e.g. MED0001234567" />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="AHPRA Expiry"
                  type="date"
                  fullWidth
                  size="small"
                  value={form.ahpraExpiry ?? ''}
                  onChange={e => set('ahpraExpiry', e.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              </Grid>
            </Grid>
          </Box>

          <Divider />

          {/* Prescriber Details */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 1, display: 'block' }}>
              Prescriber Details
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12 }}>
                <Alert severity={roleGrantsPrescribing ? 'info' : 'warning'}>
                  Prescribing privileges now come from the selected system role. Only prescriber consultant, registrar, HMO, and nurse practitioner roles can prescribe.
                </Alert>
              </Grid>
              {roleGrantsPrescribing && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField label="PBS Prescriber Number" fullWidth size="small" value={form.prescriberNumber ?? ''} onChange={e => set('prescriberNumber', e.target.value)}
                    placeholder="e.g. 1234567A" helperText="Required for PBS prescriptions" />
                </Grid>
              )}
            </Grid>
          </Box>

          <Divider />

          {/* Provider Numbers */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 1, display: 'block' }}>
              Provider Numbers
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Medicare/DVA provider numbers are location-specific. Add one for each practice location.
            </Typography>
            <Grid container spacing={2}>
              {providerNumbers.map((providerNumber, index) => (
                <Stack key={`${providerNumber.type}-${index}`} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ width: '100%' }}>
                  <FormControl size="small" sx={{ minWidth: 120, flex: { sm: '0 0 160px' } }}>
                    <InputLabel>Type</InputLabel>
                    <Select
                      value={providerNumber.type}
                      onChange={(event) => updateProviderNumber(index, 'type', event.target.value)}
                      label="Type"
                    >
                      {STAFF_PROVIDER_TYPES.map((providerType) => (
                        <MenuItem key={providerType} value={providerType}>
                          {providerType}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField
                    label="Provider Number"
                    size="small"
                    value={providerNumber.number}
                    onChange={(event) => updateProviderNumber(index, 'number', event.target.value)}
                    placeholder="e.g. 1234567A"
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    label="Location"
                    size="small"
                    value={providerNumber.location}
                    onChange={(event) => updateProviderNumber(index, 'location', event.target.value)}
                    placeholder="e.g. Main Clinic"
                    sx={{ flex: 1 }}
                  />
                  <IconButton
                    aria-label="Remove provider number"
                    color="error"
                    size="small"
                    onClick={() => removeProviderNumber(index)}
                    sx={{ alignSelf: { xs: 'flex-end', sm: 'center' } }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Stack>
              ))}
              <Grid size={{ xs: 12 }}>
                <Button size="small" startIcon={<AddIcon />} onClick={addProviderNumber}
                  sx={{ fontSize: 12, color: '#327C8D' }}>Add Provider Number</Button>
              </Grid>
            </Grid>
          </Box>

          <Divider />

          {/* Private Health Insurance */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 1, display: 'block' }}>
              Private Health Insurance
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="PHI Provider" fullWidth size="small" value={phiProvider}
                  onChange={(event) => setPhiProvider(event.target.value)} placeholder="e.g. Medibank, BUPA, HCF" />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField label="PHI Provider Number" fullWidth size="small" value={phiNumber}
                  onChange={(event) => setPhiNumber(event.target.value)} placeholder="PHI-specific provider ID" />
              </Grid>
            </Grid>
          </Box>

          <Divider />

          {/* Clinical Specialties — multi-specialty Phase 0 enrolment.
              Drives the ModuleContext visibility intersection and the
              referral coordinator auto-degrade rule. Exactly one entry
              must be marked primary when the list is non-empty. */}
          <Box>
            <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, mb: 1, display: 'block' }}>
              Clinical Specialties
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              Which specialties does this clinician work in? The primary specialty is used when prescribing
              medications (unless an episode context overrides it).
            </Typography>
            <Grid container spacing={1}>
              {ALL_SPECIALTIES.map(code => {
                const enrolled = specialtyCodes.has(code);
                const entry = specialties.find(s => s.code === code);
                return (
                  <Grid size={{ xs: 12, sm: 6 }} key={code}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, border: '1px solid', borderColor: enrolled ? '#b8621a' : 'divider', borderRadius: 1, px: 1, py: 0.25, bgcolor: enrolled ? '#FFF8F2' : 'transparent' }}>
                      <FormControlLabel
                        sx={{ flexGrow: 1, m: 0 }}
                        control={
                          <Checkbox
                            size="small"
                            checked={enrolled}
                            onChange={() => toggleSpecialty(code)}
                          />
                        }
                        label={<Typography variant="body2">{SPECIALTY_DISPLAY[code]}</Typography>}
                      />
                      {enrolled && (
                        <Tooltip title={entry?.isPrimary ? 'Primary specialty' : 'Set as primary'}>
                          <IconButton
                            size="small"
                            onClick={() => setPrimarySpecialty(code)}
                            aria-label={`Set ${SPECIALTY_DISPLAY[code]} as primary`}
                          >
                            {entry?.isPrimary
                              ? <StarIcon sx={{ color: '#b8621a', fontSize: 18 }} />
                              : <StarBorderIcon sx={{ color: 'text.secondary', fontSize: 18 }} />}
                          </IconButton>
                        </Tooltip>
                      )}
                    </Box>
                  </Grid>
                );
              })}
            </Grid>
            {specialties.length > 0 && (
              <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {specialties.map(s => (
                  <Chip
                    key={s.code}
                    size="small"
                    label={`${SPECIALTY_DISPLAY[s.code]}${s.isPrimary ? ' (primary)' : ''}`}
                    color={s.isPrimary ? 'primary' : 'default'}
                    variant={s.isPrimary ? 'filled' : 'outlined'}
                  />
                ))}
              </Box>
            )}
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
          {success && <Alert severity="success">{success}</Alert>}
        </Box>
      )}
    </Box>
  );

  if (inline) {
    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">My Profile</Typography>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saveMut.isPending || !(form.discipline ?? '').trim()}
            sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
            {saveMut.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </Box>
        {content}
      </Box>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700, fontFamily: 'Albert Sans, sans-serif' }}>
        {isSelf ? 'Edit My Profile' : 'Edit Staff Credentials'}
      </DialogTitle>
      <Divider />
      <DialogContent>{content}</DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saveMut.isPending || !(form.discipline ?? '').trim()}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' }, textTransform: 'none' }}>
          {saveMut.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

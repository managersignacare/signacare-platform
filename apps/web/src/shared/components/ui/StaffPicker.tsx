/**
 * StaffPicker — Replaces raw UUID text inputs with a searchable staff selector
 * Shows name, role, avatar. Used across task assignment, referral allocation, etc.
 */
import PersonIcon from '@mui/icons-material/Person';
import { Autocomplete, Avatar, Box, TextField, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { sharedStaffKeys } from '../../queryKeys';

interface StaffOption {
  id: string;
  givenName: string;
  familyName: string;
  email: string;
  role?: string;
}

interface StaffPickerProps {
  value: string;
  onChange: (staffId: string, staff?: StaffOption) => void;
  label?: string;
  placeholder?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  required?: boolean;
  disabled?: boolean;
  filterRole?: string; // Only show staff with this role
  excludeIds?: string[];
}

export function StaffPicker({
  value, onChange, label = 'Staff Member', placeholder = 'Search by name...',
  size = 'small', fullWidth = true, required, disabled, filterRole, excludeIds = [],
}: StaffPickerProps) {
  const [inputValue, setInputValue] = useState('');

  const { data: staffList } = useQuery({
    queryKey: sharedStaffKeys.lookup(),
    queryFn: () => apiClient.get<StaffOption[]>('staff/lookup').catch((err) => { console.warn('StaffPicker: query failed', err); return []; }),
    staleTime: 5 * 60_000,
  });

  const options: StaffOption[] = (Array.isArray(staffList) ? staffList : [])
    .filter(s => !filterRole || s.role === filterRole)
    .filter(s => !excludeIds.includes(s.id));

  const selected = options.find(s => s.id === value) ?? null;

  return (
    <Autocomplete
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      options={options}
      value={selected}
      inputValue={inputValue}
      onInputChange={(_, v) => setInputValue(v)}
      onChange={(_, v) => onChange(v?.id ?? '', v ?? undefined)}
      getOptionLabel={(o) => `${o.givenName} ${o.familyName}`}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      filterOptions={(opts, { inputValue: q }) => {
        if (!q) return opts;
        const lq = q.toLowerCase();
        return opts.filter(o =>
          `${o.givenName} ${o.familyName}`.toLowerCase().includes(lq) ||
          o.email.toLowerCase().includes(lq)
        );
      }}
      renderOption={(props, option) => (
        <Box component="li" {...props} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', py: 1 }}>
          <Avatar sx={{ width: 28, height: 28, bgcolor: '#327C8D', fontSize: 11 }}>
            {option.givenName[0]}{option.familyName[0]}
          </Avatar>
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>
              {option.givenName} {option.familyName}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
              {option.role ?? 'Staff'} | {option.email}
            </Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={placeholder}
          required={required}
          InputProps={{
            ...params.InputProps,
            startAdornment: selected ? (
              <Avatar sx={{ width: 20, height: 20, bgcolor: '#327C8D', fontSize: 9, mr: 0.5 }}>
                {selected.givenName[0]}{selected.familyName[0]}
              </Avatar>
            ) : (
              <PersonIcon sx={{ fontSize: 16, color: '#999', mr: 0.5 }} />
            ),
          }}
        />
      )}
    />
  );
}

// ── PatientPicker — Same pattern for patient selection ──
interface PatientOption {
  id: string;
  givenName: string;
  familyName: string;
  emrNumber: string;
  dateOfBirth?: string;
}

interface PatientSearchRow {
  id: string;
  givenName?: string;
  given_name?: string;
  familyName?: string;
  family_name?: string;
  emrNumber?: string;
  emr_number?: string;
  dateOfBirth?: string;
  date_of_birth?: string;
}

interface PatientSearchEnvelope {
  data?: PatientSearchRow[];
}

type PatientSearchResponse = PatientSearchEnvelope | PatientSearchRow[];

function extractPatientRows(response: PatientSearchResponse): PatientSearchRow[] {
  if (Array.isArray(response)) return response;
  if (Array.isArray(response.data)) return response.data;
  return [];
}

interface PatientPickerProps {
  value: string;
  onChange: (patientId: string, patient?: PatientOption) => void;
  label?: string;
  size?: 'small' | 'medium';
  fullWidth?: boolean;
  disabled?: boolean;
}

export function PatientPicker({
  value, onChange, label = 'Patient', size = 'small', fullWidth = true, disabled,
}: PatientPickerProps) {
  const [inputValue, setInputValue] = useState('');
  const [searchResults, setSearchResults] = useState<PatientOption[]>([]);
  const [searching, setSearching] = useState(false);

  const searchPatients = async (q: string) => {
    setInputValue(q);
    if (q.length < 2) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const response = await apiClient.get<PatientSearchResponse>('patients', { search: q, limit: 10 });
      const patients = extractPatientRows(response);
      setSearchResults(patients.map((p) => ({
        id: p.id, givenName: p.givenName ?? p.given_name ?? '',
        familyName: p.familyName ?? p.family_name ?? '',
        emrNumber: p.emrNumber ?? p.emr_number ?? '',
        dateOfBirth: p.dateOfBirth ?? p.date_of_birth ?? '',
      })));
    } catch { setSearchResults([]); }
    setSearching(false);
  };

  const selected = searchResults.find(p => p.id === value) ?? null;

  return (
    <Autocomplete
      size={size}
      fullWidth={fullWidth}
      disabled={disabled}
      options={searchResults}
      value={selected}
      inputValue={inputValue}
      onInputChange={(_, v, reason) => { if (reason === 'input') searchPatients(v); }}
      onChange={(_, v) => onChange(v?.id ?? '', v ?? undefined)}
      getOptionLabel={(o) => `${o.givenName} ${o.familyName} (${o.emrNumber})`}
      isOptionEqualToValue={(o, v) => o.id === v.id}
      loading={searching}
      noOptionsText={inputValue.length < 2 ? 'Type 2+ characters to search' : 'No patients found'}
      renderOption={(props, option) => (
        <Box component="li" {...props} sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
          <Avatar sx={{ width: 28, height: 28, bgcolor: '#b8621a', fontSize: 11 }}>
            {option.givenName[0]}{option.familyName[0]}
          </Avatar>
          <Box>
            <Typography variant="body2" fontWeight={600} sx={{ fontSize: 12 }}>
              {option.givenName} {option.familyName}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
              {option.emrNumber} | DOB: {option.dateOfBirth}
            </Typography>
          </Box>
        </Box>
      )}
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder="Search by name or MRN..." />
      )}
    />
  );
}

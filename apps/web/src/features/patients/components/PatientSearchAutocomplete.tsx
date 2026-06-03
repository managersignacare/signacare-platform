// apps/web/src/features/patients/components/PatientSearchAutocomplete.tsx
//
// Shared patient typeahead used across appointment-creation surfaces.
// Replaces the prior hand-rolled `<Paper>` + `<Box onClick>` popups in
// AppointmentsPage.tsx + AppointmentsTab.tsx (3 sites) with a canonical
// MUI <Autocomplete> per BUG-447 child 8/15 + L5 cycle-1 advisory:
// the §2.5 decision tree (docs/quality/bug-447-child-template.md)
// directs typeahead patterns to Shape C (MUI native primitive) — this
// component IS that Shape C implementation. Native combobox/listbox/
// option ARIA semantics, arrow-key + type-to-filter + Escape-to-close
// handled by MUI; no manual role/tabIndex/onKeyDown attributes needed.
//
// Reference implementation: ProviderSearchAutocomplete.tsx (NHSD
// provider-directory typeahead) in the same folder.
//
// Server-side filtering only — `filterOptions={(x) => x}` disables
// MUI's local re-filter; the backend `GET /patients?search=...&limit=10`
// already applies the prefix/contains match.

import React, { useState } from 'react';
import {
  Autocomplete, TextField, Typography, Box, InputAdornment, CircularProgress,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { patientsKeys } from '../queryKeys';

export interface PatientOption {
  id: string;
  givenName: string;
  familyName: string;
  emrNumber: string;
}

interface Props {
  /** Currently-selected patient (controlled). null when nothing selected. */
  value: PatientOption | null;
  /** Called when the user selects a patient OR clears the field. */
  onChange: (patient: PatientOption | null) => void;
  placeholder?: string;
  fullWidth?: boolean;
  /** Override the outer Autocomplete sx (e.g. minWidth). */
  sx?: object;
}

export const PatientSearchAutocomplete: React.FC<Props> = ({
  value,
  onChange,
  placeholder = 'Search patient by name or UR…',
  fullWidth = false,
  sx,
}) => {
  const [inputValue, setInputValue] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: patientsKeys.patientSearch(inputValue),
    queryFn: () => apiClient.get<{ data: PatientOption[] }>('patients', { search: inputValue, limit: 10 }),
    enabled: inputValue.length >= 2,
    staleTime: 10_000,
  });
  const options = data?.data ?? [];

  return (
    <Autocomplete<PatientOption, false, false, false>
      value={value}
      onChange={(_e, v) => onChange(v)}
      inputValue={inputValue}
      onInputChange={(_e, v) => setInputValue(v)}
      options={options}
      loading={isFetching && inputValue.length >= 2}
      filterOptions={(x) => x}
      getOptionLabel={(o) => `${o.familyName}, ${o.givenName} — ${o.emrNumber}`}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      noOptionsText={inputValue.length < 2 ? 'Type at least 2 characters' : 'No matching patients'}
      size="small"
      fullWidth={fullWidth}
      sx={sx}
      renderInput={(params) => (
        <TextField
          {...params}
          placeholder={placeholder}
          slotProps={{
            input: {
              ...params.InputProps,
              startAdornment: (
                <>
                  <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment>
                  {params.InputProps.startAdornment}
                </>
              ),
              endAdornment: (
                <>
                  {isFetching && inputValue.length >= 2 && (
                    <CircularProgress role="progressbar" aria-label="Searching patients" color="inherit" size={16} />
                  )}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
          sx={{ bgcolor: '#fff' }}
        />
      )}
      renderOption={({ key, ...props }, p) => (
        <Box component="li" key={key} {...props}>
          <Typography variant="body2" fontWeight={500}>
            {p.familyName}, {p.givenName} — {p.emrNumber}
          </Typography>
        </Box>
      )}
    />
  );
};

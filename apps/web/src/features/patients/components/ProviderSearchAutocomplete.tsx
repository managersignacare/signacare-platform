// apps/web/src/features/patients/components/ProviderSearchAutocomplete.tsx
import React, { useState } from 'react';
import {
  Autocomplete, Box, CircularProgress, TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useProviderSearch, type NhsdProvider } from '../hooks/useProviderSearch';

interface Props {
  /** Called when the user selects a provider from the results */
  onSelect: (provider: NhsdProvider) => void;
  /** Optional postcode to narrow proximity results */
  postcode?: string;
  /** Label for the search field */
  label?: string;
}

export const ProviderSearchAutocomplete: React.FC<Props> = ({
  onSelect,
  postcode,
  label = 'Search NHSD provider directory...',
}) => {
  const [inputValue, setInputValue] = useState('');
  const { data, isLoading, isFetching } = useProviderSearch(inputValue, postcode);

  const options = data?.providers ?? [];
  const loading = isLoading || isFetching;

  return (
    <Autocomplete<NhsdProvider, false, false, true>
      freeSolo
      options={options}
      loading={loading}
      inputValue={inputValue}
      onInputChange={(_e, value) => setInputValue(value)}
      onChange={(_e, value) => {
        if (value && typeof value !== 'string') onSelect(value);
      }}
      getOptionLabel={(option) =>
        typeof option === 'string' ? option : option.name
      }
      filterOptions={(x) => x} // Server-side filtering, don't filter locally
      isOptionEqualToValue={(a, b) => a.id === b.id}
      renderOption={({ key, ...props }, option) => (
        <Box component="li" key={key} {...props} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important', py: 1 }}>
          <Typography fontSize={14} fontWeight={600} fontFamily="Albert Sans, sans-serif">
            {option.name}
          </Typography>
          {option.practiceName && (
            <Typography fontSize={12} color="text.secondary" fontFamily="Albert Sans, sans-serif">
              {option.practiceName}
              {option.specialty ? ` — ${option.specialty}` : ''}
            </Typography>
          )}
          <Typography fontSize={11} color="text.disabled" fontFamily="Albert Sans, sans-serif">
            {[option.address.suburb, option.address.state, option.address.postcode].filter(Boolean).join(', ')}
            {option.phone ? ` • ${option.phone}` : ''}
          </Typography>
        </Box>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          size="small"
          placeholder="Type provider name (min 2 chars)"
          slotProps={{
            input: {
              ...params.InputProps,
              startAdornment: <SearchIcon sx={{ color: 'text.disabled', mr: 0.5, fontSize: 18 }} />,
              endAdornment: (
                <>
                  {loading && <CircularProgress role="progressbar" aria-label="Loading" color="inherit" size={16} />}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
          sx={{ '& .MuiInputBase-root': { fontFamily: 'Albert Sans, sans-serif' } }}
        />
      )}
      noOptionsText={
        inputValue.length < 2
          ? 'Type at least 2 characters to search'
          : data?.error
            ? `Directory unavailable: ${data.error}`
            : 'No providers found'
      }
      sx={{ mb: 2 }}
    />
  );
};

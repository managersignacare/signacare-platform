import React, { useMemo } from 'react';
import {
  Autocomplete,
  TextField,
  Chip,
  ListSubheader,
  type AutocompleteRenderInputParams,
} from '@mui/material';

export interface SignacareSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SignacareSelectGroup {
  groupLabel: string;
  options: SignacareSelectOption[];
}

type OptionOrGroup = SignacareSelectOption | SignacareSelectGroup;

function isGroup(item: OptionOrGroup): item is SignacareSelectGroup {
  return 'groupLabel' in item;
}

function flattenOptions(items: OptionOrGroup[]): SignacareSelectOption[] {
  return items.flatMap((item) => (isGroup(item) ? item.options : item));
}

export interface SignacareSelectProps {
  id?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  options: OptionOrGroup[];
  value?: string | string[] | null;
  onChange?: (value: string | string[] | null) => void;
  multiple?: boolean;
  searchable?: boolean;
  error?: boolean;
  errorMessage?: string;
  helperText?: string;
  disabled?: boolean;
  required?: boolean;
  fullWidth?: boolean;
  size?: 'small' | 'medium';
  clearable?: boolean;
}

export const SignacareSelect: React.FC<SignacareSelectProps> = ({
  id,
  name,
  label,
  placeholder,
  options,
  value,
  onChange,
  multiple = false,
  searchable = true,
  error = false,
  errorMessage,
  helperText,
  disabled,
  required,
  fullWidth = true,
  size = 'small',
  clearable = true,
}) => {
  const flat = useMemo(() => flattenOptions(options), [options]);
  const hasError = error || Boolean(errorMessage);
  const displayHelper = errorMessage ?? helperText;

  const selected = useMemo(() => {
    if (multiple) {
      const vals = (value as string[] | null | undefined) ?? [];
      return flat.filter((o) => vals.includes(o.value));
    }
    return flat.find((o) => o.value === value) ?? null;
  }, [flat, value, multiple]);

  const handleChange = (
    _: React.SyntheticEvent,
    newVal: SignacareSelectOption | SignacareSelectOption[] | null,
  ): void => {
    if (!onChange) return;
    if (multiple) {
      onChange((newVal as SignacareSelectOption[]).map((o) => o.value));
    } else {
      onChange((newVal as SignacareSelectOption | null)?.value ?? null);
    }
  };

  const groupMap = useMemo(() => {
    const m = new Map<string, string>();
    options.forEach((item) => {
      if (isGroup(item)) {
        item.options.forEach((opt) => {
          m.set(opt.value, item.groupLabel);
        });
      }
    });
    return m;
  }, [options]);

  const hasGroups = options.some(isGroup);

  return (
    <Autocomplete
      id={id}
      multiple={multiple}
      options={flat}
      value={
        multiple
          ? (selected as SignacareSelectOption[])
          : (selected as SignacareSelectOption | null)
      }
      onChange={handleChange}
      disableClearable={!clearable as false}
      disabled={disabled}
      fullWidth={fullWidth}
      freeSolo={false}
      filterOptions={searchable ? undefined : (opts) => opts}
      getOptionLabel={(opt) => (typeof opt === 'string' ? opt : opt.label)}
      getOptionDisabled={(opt) => opt.disabled ?? false}
      isOptionEqualToValue={(opt, val) => opt.value === val.value}
      groupBy={
        hasGroups ? (opt) => groupMap.get(opt.value) ?? '' : undefined
      }
      renderInput={(params: AutocompleteRenderInputParams) => (
        <TextField
          {...params}
          name={name}
          label={label}
          placeholder={placeholder}
          required={required}
          error={hasError}
          helperText={displayHelper}
          size={size}
          variant="outlined"
          sx={{
            '& .MuiOutlinedInput-root': {
              fontFamily: 'Albert Sans, sans-serif',
              borderRadius: '8px',
            },
            '& .Mui-error .MuiOutlinedInput-notchedOutline': {
              borderColor: '#D32F2F',
            },
            '& .MuiFormHelperText-root.Mui-error': {
              color: '#D32F2F',
            },
          }}
        />
      )}
      renderGroup={(params) => (
        <li key={params.key}>
          {params.group && <ListSubheader>{params.group}</ListSubheader>}
          {params.children}
        </li>
      )}
      renderTags={(vals, getTagProps) =>
        (vals as SignacareSelectOption[]).map((opt, idx) => {
          // Destructuring the key to handle it explicitly and avoid spread conflicts
          const { key, ...tagProps } = getTagProps({ index: idx });
          return (
            <Chip
              key={key}
              label={opt.label}
              size="small"
              sx={{
                bgcolor: 'rgba(50,124,141,0.1)',
                color: '#327C8D',
                fontFamily: 'Albert Sans, sans-serif',
                fontWeight: 600,
                fontSize: '0.7rem',
              }}
              {...tagProps}
            />
          );
        })
      }
    />
  );
};
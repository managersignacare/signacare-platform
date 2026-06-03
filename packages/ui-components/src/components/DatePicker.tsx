import React from 'react';
import {
  DatePicker,
  DateTimePicker,
} from '@mui/x-date-pickers';
import { TextField } from '@mui/material';
import { parseISO } from 'date-fns';

export interface SignacareDatePickerProps {
  label?: string;
  value: string | null;
  onChange: (value: string | null) => void;
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
  required?: boolean;
  error?: boolean;
  helperText?: string;
  variant?: 'date' | 'datetime';
}

export function SignacareDatePicker({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  disabled,
  required,
  error,
  helperText,
  variant = 'date',
}: SignacareDatePickerProps): React.ReactElement {
  const Picker = variant === 'datetime'
    ? DateTimePicker
    : DatePicker;

  const parsed =
    value != null && value !== ''
      ? parseISO(value)
      : null;

  return (
    <Picker
      value={parsed}
      // Explicitly typed the incoming date parameter
      onChange={(date: Date | null) =>
        onChange(date ? date.toISOString() : null)
      }
      {...(label !== undefined ? { label } : {})}
      {...(minDate !== undefined ? { minDate } : {})}
      {...(maxDate !== undefined ? { maxDate } : {})}
      {...(disabled !== undefined ? { disabled } : {})}
      slotProps={{
        textField: {
          required,
          error,
          helperText,
          fullWidth: true,
          size: 'small',
        } as Parameters<typeof TextField>[0],
      }}
    />
  );
}

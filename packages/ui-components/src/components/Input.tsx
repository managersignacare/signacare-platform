import React from 'react';
import {
  TextField,
  type TextFieldProps,
  InputAdornment,
} from '@mui/material';

export interface SignacareInputProps {
  id?: string;
  name?: string;
  label?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  helperText?: string;
  error?: boolean;
  errorMessage?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  fullWidth?: boolean;
  multiline?: boolean;
  rows?: number;
  maxRows?: number;
  type?: React.InputHTMLAttributes<HTMLInputElement>['type'];
  startAdornment?: React.ReactNode;
  endAdornment?: React.ReactNode;
  size?: 'small' | 'medium';
  onChange?: React.ChangeEventHandler<
    HTMLInputElement | HTMLTextAreaElement
  >;
  onBlur?: React.FocusEventHandler<
    HTMLInputElement | HTMLTextAreaElement
  >;
  onFocus?: React.FocusEventHandler<
    HTMLInputElement | HTMLTextAreaElement
  >;
  inputRef?: React.Ref<HTMLInputElement>;
  autoComplete?: string;
  autoFocus?: boolean;
  sx?: TextFieldProps['sx'];
}

export const SignacareInput = React.forwardRef<
  HTMLDivElement,
  SignacareInputProps
>(function SignacareInput(
  {
    id,
    name,
    label,
    value,
    defaultValue,
    placeholder,
    helperText,
    error = false,
    errorMessage,
    disabled,
    readOnly,
    required,
    fullWidth = true,
    multiline,
    rows,
    maxRows,
    type = 'text',
    startAdornment,
    endAdornment,
    size = 'small',
    onChange,
    onBlur,
    onFocus,
    inputRef,
    autoComplete,
    autoFocus,
    sx,
  },
  ref,
) {
  const hasError = error || Boolean(errorMessage);
  const displayHelper = errorMessage ?? helperText;

  return (
    <TextField
      ref={ref}
      id={id}
      name={name}
      label={label}
      value={value}
      defaultValue={defaultValue}
      placeholder={placeholder}
      error={hasError}
      helperText={displayHelper}
      disabled={disabled}
      required={required}
      fullWidth={fullWidth}
      multiline={multiline}
      rows={rows}
      maxRows={maxRows}
      type={type}
      size={size}
      variant="outlined"
      onChange={onChange}
      onBlur={onBlur}
      onFocus={onFocus}
      inputRef={inputRef}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
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
        ...sx,
      }}
      slotProps={{
        input: {
          readOnly,
          startAdornment: startAdornment ? (
            <InputAdornment position="start">
              {startAdornment}
            </InputAdornment>
          ) : undefined,
          endAdornment: endAdornment ? (
            <InputAdornment position="end">
              {endAdornment}
            </InputAdornment>
          ) : undefined,
        },
      }}
    />
  );
});

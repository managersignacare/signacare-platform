/**
 * DigitInput — Individual digit boxes for Medicare numbers, IRN, dates
 * Auto-advances focus to next box on input. Backspace moves to previous.
 */
import React, { useRef, useCallback } from 'react';
import { Box, TextField, Typography } from '@mui/material';

interface DigitInputProps {
  value: string;
  onChange: (value: string) => void;
  length: number;
  label?: string;
  grouping?: number[]; // e.g. [4,5,1] for Medicare XXXX XXXXX X
  error?: string;
  separator?: string;
  type?: 'digit' | 'date'; // date = MM/YYYY
}

export function DigitInput({ value, onChange, length, label, grouping, error, separator = ' ' }: DigitInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.replace(/\D/g, '').split('').concat(Array(length).fill('')).slice(0, length);

  const handleChange = useCallback((index: number, char: string) => {
    if (!/^\d?$/.test(char)) return;
    const next = [...digits];
    next[index] = char;
    onChange(next.join(''));
    // Auto-advance to next input
    if (char && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }, [digits, length, onChange]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
      const next = [...digits];
      next[index - 1] = '';
      onChange(next.join(''));
    }
    if (e.key === 'ArrowLeft' && index > 0) refs.current[index - 1]?.focus();
    if (e.key === 'ArrowRight' && index < length - 1) refs.current[index + 1]?.focus();
  }, [digits, length, onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    onChange(pasted);
    const focusIdx = Math.min(pasted.length, length - 1);
    setTimeout(() => refs.current[focusIdx]?.focus(), 50);
  }, [length, onChange]);

  // Determine group boundaries for visual spacing
  const groupBoundaries = new Set<number>();
  if (grouping) {
    let pos = 0;
    for (const g of grouping) {
      pos += g;
      if (pos < length) groupBoundaries.add(pos);
    }
  }

  return (
    <Box>
      {label && <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5, fontSize: 11 }}>{label}</Typography>}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
        {digits.map((d, i) => (
          <React.Fragment key={i}>
            <TextField
              inputRef={el => { refs.current[i] = el; }}
              value={d}
              onChange={e => handleChange(i, e.target.value.slice(-1))}
              onKeyDown={e => handleKeyDown(i, e)}
              onPaste={i === 0 ? handlePaste : undefined}
              inputProps={{
                maxLength: 1,
                style: { textAlign: 'center', fontSize: 16, fontWeight: 700, fontFamily: 'monospace', padding: '6px 0', width: 28 },
                inputMode: 'numeric',
              }}
              size="small"
              sx={{
                width: 36, '& .MuiOutlinedInput-root': { borderRadius: 1 },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: error ? '#D32F2F' : '#ccc' },
              }}
            />
            {groupBoundaries.has(i + 1) && (
              <Typography sx={{ mx: 0.5, color: '#999', fontSize: 14, fontWeight: 300 }}>{separator}</Typography>
            )}
          </React.Fragment>
        ))}
      </Box>
      {error && <Typography variant="caption" color="error" sx={{ mt: 0.25, display: 'block', fontSize: 10 }}>{error}</Typography>}
    </Box>
  );
}

/** Date input with MM / YYYY boxes */
interface DateDigitInputProps { value: string; onChange: (v: string) => void; label?: string; error?: string }
export function DateDigitInput({ value, onChange, label, error }: DateDigitInputProps) {
  const parts = value.split('/');
  const mm = parts[0] ?? '';
  const yyyy = parts[1] ?? '';

  return (
    <Box>
      {label && <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5, fontSize: 11 }}>{label}</Typography>}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <DigitInput value={mm} onChange={v => onChange(`${v}/${yyyy}`)} length={2} />
        <Typography sx={{ color: '#999', fontSize: 16 }}>/</Typography>
        <DigitInput value={yyyy} onChange={v => onChange(`${mm}/${v}`)} length={4} />
      </Box>
      {error && <Typography variant="caption" color="error" sx={{ mt: 0.25, display: 'block', fontSize: 10 }}>{error}</Typography>}
    </Box>
  );
}

/** Phone number input with grouped digits */
interface PhoneInputProps { value: string; onChange: (v: string) => void; label?: string; error?: string }
export function PhoneInput({ value, onChange, label, error }: PhoneInputProps) {
  const digits = value.replace(/\D/g, '');

  return (
    <Box>
      {label && <Typography variant="caption" fontWeight={600} sx={{ display: 'block', mb: 0.5, fontSize: 11 }}>{label}</Typography>}
      <DigitInput value={digits} onChange={v => onChange(v)} length={10} grouping={[4, 3, 3]} error={error} />
      {!error && digits.length > 0 && digits.length < 10 && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25, display: 'block', fontSize: 10 }}>{10 - digits.length} digits remaining</Typography>
      )}
    </Box>
  );
}

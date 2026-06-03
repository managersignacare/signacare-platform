import { Checkbox, FormControlLabel, Typography } from '@mui/material';

type AiDraftSignAttestationCheckboxProps = {
  visible: boolean;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export function AiDraftSignAttestationCheckbox({
  visible,
  checked,
  onChange,
}: AiDraftSignAttestationCheckboxProps) {
  if (!visible) {
    return null;
  }

  return (
    <FormControlLabel
      sx={{ mr: 1 }}
      control={(
        <Checkbox
          checked={checked}
          onChange={(_, nextChecked) => onChange(nextChecked)}
          size="small"
        />
      )}
      label={(
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          I have reviewed and adopted this AI draft
        </Typography>
      )}
    />
  );
}

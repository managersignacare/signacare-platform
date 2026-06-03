import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Typography,
  Stack,
  Divider,
  Alert,
  CircularProgress,
  Box,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useForm, Controller, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useCreateEscalation } from '../hooks/useEscalations';
import {
  CreateEscalationSchema,
  ASSIGNED_TEAMS,
  type CreateEscalationDTO,
  type EscalationPriority,
} from '../types/escalationTypes';
import type { EscalationResponse } from '../types/escalationTypes';

const ISBAR_FIELDS: {
  name: 'situation' | 'background' | 'assessment' | 'recommendation';
  label: string;
  placeholder: string;
  rows: number;
}[] = [
  {
    name: 'situation',
    label: 'S — Situation',
    placeholder: 'What is happening right now? Briefly state the current problem.',
    rows: 2,
  },
  {
    name: 'background',
    label: 'B — Background',
    placeholder: 'Relevant history, diagnosis, current treatment, recent changes.',
    rows: 3,
  },
  {
    name: 'assessment',
    label: 'A — Assessment',
    placeholder: 'Your clinical assessment of the situation and risk level.',
    rows: 3,
  },
  {
    name: 'recommendation',
    label: 'R — Recommendation',
    placeholder: 'What action do you need from the receiving team?',
    rows: 2,
  },
];

const PRIORITY_OPTIONS: {
  value: EscalationPriority;
  label: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  { value: 'routine',   label: 'Routine',   icon: <InfoOutlinedIcon fontSize="small" />,  color: '#1565C0' },
  { value: 'urgent',    label: 'Urgent',    icon: <WarningAmberIcon fontSize="small" />,  color: '#F57F17' },
  { value: 'emergency', label: 'Emergency', icon: <ErrorOutlineIcon fontSize="small" />,  color: '#C62828' },
];

interface EscalationFormProps {
  open:      boolean;
  patientId: string;
  episodeId?: string;
  onClose:   () => void;
  onCreated: (escalation: EscalationResponse) => void;
}

export const EscalationForm: React.FC<EscalationFormProps> = ({
  open,
  patientId,
  episodeId,
  onClose,
  onCreated,
}) => {
  const createEscalation = useCreateEscalation(patientId);

  const {
    control,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<CreateEscalationDTO>({
    resolver: zodResolver(CreateEscalationSchema) as Resolver<CreateEscalationDTO>,
    defaultValues: {
      patientId,
      episodeId,
      assignedTeam: '',
      priority: 'urgent',
      isbar: {
        situation:      '',
        background:     '',
        assessment:     '',
        recommendation: '',
      },
    },
  });

  const onSubmit = async (data: CreateEscalationDTO) => {
    const escalation = await createEscalation.mutateAsync(data);
    reset();
    onCreated(escalation);
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle
        id="dialog-title"
        sx={{
          fontFamily: 'Albert Sans, sans-serif',
          fontWeight: 700,
          color: '#3D484B',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <WarningAmberIcon sx={{ color: '#F0852C' }} />
        Raise Escalation (ISBAR)
      </DialogTitle>
      <Divider />

      <form onSubmit={handleSubmit(onSubmit)}>
        <DialogContent>
          <Stack spacing={3}>
            <Alert role="alert"
              severity="warning"
              sx={{
                backgroundColor: '#FFF8E1',
                border: '1px solid #F0852C',
                fontFamily: 'Albert Sans, sans-serif',
              }}
            >
              Use this form to escalate care to another team (e.g. Inpatient,
              ACIS, CATT). Complete the ISBAR fields clearly and completely.
            </Alert>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Controller
                name="assignedTeam"
                control={control}
                render={({ field }) => (
                  <FormControl fullWidth size="small" error={Boolean(errors.assignedTeam)}>
                    <InputLabel sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
                      Escalate to team *
                    </InputLabel>
                    <Select
                      {...field}
                      label="Escalate to team *"
                      sx={{ fontFamily: 'Albert Sans, sans-serif' }}
                    >
                      {ASSIGNED_TEAMS.map((t) => (
                        <MenuItem key={t} value={t} sx={{ fontFamily: 'Albert Sans, sans-serif' }}>
                          {t}
                        </MenuItem>
                      ))}
                    </Select>
                    {errors.assignedTeam && (
                      <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                        {errors.assignedTeam.message}
                      </Typography>
                    )}
                  </FormControl>
                )}
              />

              <Controller
                name="priority"
                control={control}
                render={({ field }) => (
                  <Box>
                    <Typography
                      variant="caption"
                      sx={{
                        display: 'block',
                        mb: 0.5,
                        fontFamily: 'Albert Sans, sans-serif',
                        color: '#3D484B',
                        fontWeight: 600,
                      }}
                    >
                      Priority *
                    </Typography>
                    <ToggleButtonGroup
                      exclusive
                      value={field.value}
                      onChange={(_, v) => v && field.onChange(v)}
                      size="small"
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <ToggleButton
                          key={p.value}
                          value={p.value}
                          sx={{
                            fontFamily: 'Albert Sans, sans-serif',
                            textTransform: 'none',
                            fontSize: 13,
                            gap: 0.5,
                            '&.Mui-selected': {
                              color: p.color,
                              borderColor: p.color,
                              backgroundColor: `${p.color}18`,
                            },
                          }}
                        >
                          {p.icon}
                          {p.label}
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  </Box>
                )}
              />
            </Stack>

            <Divider>
              <Typography
                variant="caption"
                sx={{
                  fontFamily: 'Albert Sans, sans-serif',
                  color: '#327C8D',
                  fontWeight: 700,
                  letterSpacing: 1,
                  textTransform: 'uppercase',
                }}
              >
                ISBAR Communication
              </Typography>
            </Divider>

            {ISBAR_FIELDS.map((f) => (
              <Controller
                key={f.name}
                name={`isbar.${f.name}` as `isbar.situation` | `isbar.background` | `isbar.assessment` | `isbar.recommendation`}
                control={control}
                render={({ field }) => (
                  <TextField
                    {...field}
                    label={f.label}
                    placeholder={f.placeholder}
                    multiline
                    minRows={f.rows}
                    fullWidth
                    size="small"
                    InputLabelProps={{
                      sx: {
                        fontFamily: 'Albert Sans, sans-serif',
                        fontWeight: 700,
                        color: '#327C8D',
                      },
                    }}
                    inputProps={{ style: { fontFamily: 'Albert Sans, sans-serif' } }}
                    sx={{
                      '& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: '#327C8D',
                      },
                    }}
                  />
                )}
              />
            ))}

            {createEscalation.isError && (
              <Alert role="alert" severity="error">Failed to raise escalation. Please try again.</Alert>
            )}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} color="inherit" disabled={createEscalation.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={createEscalation.isPending}
            startIcon={
              createEscalation.isPending
                ? <CircularProgress role="progressbar" aria-label="Loading" size={16} color="inherit" />
                : <WarningAmberIcon />
            }
            sx={{
              backgroundColor: '#F0852C',
              fontFamily: 'Albert Sans, sans-serif',
              '&:hover': { backgroundColor: '#c96d22' },
            }}
          >
            {createEscalation.isPending ? 'Raising…' : 'Raise Escalation'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
};

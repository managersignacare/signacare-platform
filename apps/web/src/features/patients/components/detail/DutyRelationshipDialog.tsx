import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DUTY_RELATIONSHIP_DURATION_HOURS,
  getAllowedDutyRelationshipTypes,
  type DutyRelationshipDurationHours,
  type DutyRelationshipType,
} from '@signacare/shared';
import { SignacareApiError } from '../../../../shared/services/apiClient';
import { useAuthStore } from '../../../../shared/store/authStore';
import { patientsKeys } from '../../queryKeys';
import {
  patientDutyRelationshipApi,
  type PatientDutyRelationship,
} from '../../services/patientDutyRelationshipApi';

interface DutyRelationshipDialogProps {
  open: boolean;
  patientId: string;
  defaultRelationshipType?: DutyRelationshipType;
  onClose: () => void;
  onCreated?: (relationship: PatientDutyRelationship) => void;
}

function labelForRelationshipType(type: DutyRelationshipType): string {
  return type === 'duty_prescriber' ? 'Duty Prescriber' : 'Duty Clinician';
}

function helperForRelationshipType(type: DutyRelationshipType): string {
  return type === 'duty_prescriber'
    ? 'Use this when you are the on-duty prescriber covering the patient.'
    : 'Use this when you are clinically covering the patient on shift.';
}

export function DutyRelationshipDialog({
  open,
  patientId,
  defaultRelationshipType,
  onClose,
  onCreated,
}: DutyRelationshipDialogProps) {
  const queryClient = useQueryClient();
  const userRole = useAuthStore((s) => s.user?.role ?? null);
  const allowedTypes = useMemo(
    () => getAllowedDutyRelationshipTypes(userRole),
    [userRole],
  );

  const [relationshipType, setRelationshipType] = useState<DutyRelationshipType>('duty_clinician');
  const [reason, setReason] = useState('');
  const [expiresInHours, setExpiresInHours] =
    useState<DutyRelationshipDurationHours>(12);

  useEffect(() => {
    if (!open) return;
    const nextType =
      defaultRelationshipType && allowedTypes.includes(defaultRelationshipType)
        ? defaultRelationshipType
        : allowedTypes[0] ?? 'duty_clinician';
    setRelationshipType(nextType);
    setReason('');
    setExpiresInHours(12);
    mutation.reset();
  }, [allowedTypes, defaultRelationshipType, open]);

  const mutation = useMutation({
    mutationFn: () =>
      patientDutyRelationshipApi.create(patientId, {
        relationshipType,
        reason,
        expiresInHours,
      }),
    onSuccess: async (relationship) => {
      await queryClient.invalidateQueries({
        queryKey: patientsKeys.dutyRelationshipsMe(patientId),
      });
      onCreated?.(relationship);
      onClose();
    },
  });

  const errorMessage =
    mutation.error instanceof SignacareApiError
      ? mutation.error.message
      : mutation.error instanceof Error
      ? mutation.error.message
      : '';

  const canSubmit =
    allowedTypes.length > 0
    && reason.trim().length >= 5
    && !mutation.isPending;

  return (
    <Dialog open={open} onClose={mutation.isPending ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Duty Relationship</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Add a temporary, auditable patient relationship so you can proceed while covering this patient on duty.
        </Typography>

        {allowedTypes.length === 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Your current system role cannot request a duty relationship for this patient.
          </Alert>
        )}

        {errorMessage && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage}
          </Alert>
        )}

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>Relationship Type</InputLabel>
          <Select
            value={relationshipType}
            label="Relationship Type"
            onChange={(event) =>
              setRelationshipType(event.target.value as DutyRelationshipType)
            }
            disabled={allowedTypes.length === 0 || mutation.isPending}
          >
            {allowedTypes.map((type) => (
              <MenuItem key={type} value={type}>
                {labelForRelationshipType(type)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
          {helperForRelationshipType(relationshipType)}
        </Typography>

        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>Access Window</InputLabel>
          <Select
            value={expiresInHours}
            label="Access Window"
            onChange={(event) =>
              setExpiresInHours(event.target.value as DutyRelationshipDurationHours)
            }
            disabled={mutation.isPending}
          >
            {DUTY_RELATIONSHIP_DURATION_HOURS.map((hours) => (
              <MenuItem key={hours} value={hours}>
                {hours} hours
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <TextField
          label="Why are you covering this patient?"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={mutation.isPending}
          fullWidth
          multiline
          minRows={3}
          helperText="Required. This reason is written to the audit trail."
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate()}
          variant="contained"
          disabled={!canSubmit}
        >
          {mutation.isPending ? 'Adding...' : 'Add Relationship'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default DutyRelationshipDialog;

// apps/web/src/features/patients/components/duplicateDetection/DuplicatePatientModal.tsx
//
// Displays the duplicate-patient warning surfaced by the patient-
// registration wizard's pre-flight check (BUG-447-FOLLOWUP-WIZARD-
// PREFLIGHT-DUPLICATE-CHECK). Consumes the minimal
// `DuplicatePatientDisplay` shape — id + emrNumber + names + DOB —
// produced by the snake→camel mapper in `useCheckDuplicatePatients`.
// Medicare is intentionally NOT shown here: the duplicates/check
// endpoint strips Medicare/IHI/DVA from its response (privacy-by-
// scope), and the modal's prop type makes that contract explicit.

import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import type { DuplicatePatientDisplay } from '../../types/duplicateTypes';

interface DuplicatePatientModalProps {
  open: boolean;
  duplicates: DuplicatePatientDisplay[];
  onContinue: () => void;
  onClose: () => void;
}

export const DuplicatePatientModal: React.FC<DuplicatePatientModalProps> = ({
  open,
  duplicates,
  onContinue,
  onClose,
}) => {
  const navigate = useNavigate();

  const handleSelectExisting = (id: string) => {
    onClose();
    navigate(`/patients/${id}`);
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        id="dialog-title"
        sx={{
          fontFamily: 'Albert Sans, sans-serif',
          fontWeight: 700,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: '#F0852C',
        }}
      >
        <WarningAmberIcon />
        Possible Duplicate Patients
      </DialogTitle>

      <DialogContent>
        <Alert role="alert" severity="warning" sx={{ mb: 2, fontFamily: 'Albert Sans, sans-serif' }}>
          {duplicates.length} existing patient record{duplicates.length > 1 ? 's' : ''} may
          match the details you entered. Please review before creating a new record.
        </Alert>

        <Typography
          variant="body2"
          color="text.secondary"
          fontFamily="Albert Sans, sans-serif"
          sx={{ mb: 1 }}
        >
          Click a record to open it, or continue to register a new patient.
        </Typography>

        <Divider sx={{ mb: 1 }} />

        <List dense>
          {duplicates.map((p) => {
            const dob = p.dateOfBirth
              ? new Date(p.dateOfBirth).toLocaleDateString('en-AU')
              : '—';
            return (
              <ListItemButton
                key={p.id}
                onClick={() => handleSelectExisting(p.id)}
                sx={{ borderRadius: 1, mb: 0.5, border: '1px solid', borderColor: 'divider' }}
              >
                <ListItemText
                  primary={
                    <Typography fontFamily="Albert Sans, sans-serif" fontWeight={500}>
                      {p.familyName}, {p.givenName}
                    </Typography>
                  }
                  secondary={
                    <Box component="span" sx={{ display: 'flex', gap: 2 }}>
                      <Typography component="span" variant="caption" fontFamily="Albert Sans, sans-serif">
                        DOB: {dob}
                      </Typography>
                      {p.emrNumber && (
                        <Typography component="span" variant="caption" fontFamily="Albert Sans, sans-serif">
                          MRN: {p.emrNumber}
                        </Typography>
                      )}
                    </Box>
                  }
                />
              </ListItemButton>
            );
          })}
        </List>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button
          onClick={onClose}
          variant="outlined"
          sx={{ fontFamily: 'Albert Sans, sans-serif', borderColor: '#327C8D', color: '#327C8D' }}
        >
          Cancel
        </Button>
        <Button
          onClick={onContinue}
          variant="contained"
          sx={{
            fontFamily: 'Albert Sans, sans-serif',
            bgcolor: '#327C8D',
            '&:hover': { bgcolor: '#265f6d' },
          }}
        >
          Continue – Create New Patient
        </Button>
      </DialogActions>
    </Dialog>
  );
};

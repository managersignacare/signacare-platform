import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Typography,
} from '@mui/material';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';

interface AmbientScribeConsentDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function AmbientScribeConsentDialog({
  open,
  onClose,
  onConfirm,
}: AmbientScribeConsentDialogProps) {
  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 700 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LocalHospitalIcon sx={{ color: '#327C8D' }} />
          Medical-Grade Clinical Scribe
        </Box>
      </DialogTitle>
      <Divider />
      <DialogContent>
        <Typography variant="body2" sx={{ mb: 2 }}>
          The Medical-Grade Scribe uses your device&apos;s microphone to listen to the clinical encounter. Long recordings are uploaded to Signacare&apos;s private clinical AI runtime for durable asynchronous transcription and note generation, so processing can continue safely if the browser disconnects.
        </Typography>
        <Paper variant="outlined" sx={{ p: 2, bgcolor: '#FBF8F5' }}>
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>3-Pass Medical Pipeline:</Typography>
          <Typography variant="body2" component="div">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>Audio captured via browser microphone, then uploaded for server-side async processing when the encounter is submitted</li>
              <li><strong>Pass 1:</strong> Whisper transcription + verbatim clinical fact extraction</li>
              <li><strong>Pass 2:</strong> Medication dose verification, risk pattern detection, safety alerts</li>
              <li><strong>Pass 3:</strong> RANZCP-standard clinical note formatting with confidence scoring</li>
              <li><strong>No patient data leaves the controlled Signacare environment</strong> — processing uses the clinic-approved AI runtime</li>
              <li>Raw audio is deleted immediately by default, or retained only for the clinic-configured review window with deletion proof</li>
              <li>Outputs are AI-assisted drafts and require clinician review before use</li>
              <li>All AI calls are audit-logged</li>
            </ul>
          </Typography>
        </Paper>
        <Alert severity="info" sx={{ mt: 2 }}>
          <strong>Patient consent required.</strong> Confirm the patient has been informed about recording, server-side asynchronous processing, the clinic&apos;s audio-retention setting, and clinician review before the output enters the clinical record.
        </Alert>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        <Button variant="contained" onClick={onConfirm} sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
          Patient Consent Confirmed — Start Recording
        </Button>
      </DialogActions>
    </Dialog>
  );
}

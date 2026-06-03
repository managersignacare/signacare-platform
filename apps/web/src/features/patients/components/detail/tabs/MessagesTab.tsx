import { Alert, Box, Typography } from '@mui/material';

interface MessagesTabProps { patientId: string }
export function MessagesTab(_props: MessagesTabProps) {
  return (
    <Box>
      <Typography variant="h6" fontWeight={600} fontFamily="Albert Sans, sans-serif" sx={{ mb: 2 }}>
        Messages
      </Typography>
      <Alert severity="info">
        Internal messages and secure communications related to this patient will appear here.
      </Alert>
    </Box>
  );
}
export default MessagesTab;

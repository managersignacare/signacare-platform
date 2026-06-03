import { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Stack,
  Alert,
} from '@mui/material';
import { useRequestClarification, useAddClarificationResponse } from '../hooks/useClarification';

interface ClarificationPanelProps {
  referralId: string;
  clarificationNotes?: string | null;
  status?: string;
  canRequest?: boolean;
  canRespond?: boolean;
}

export function ClarificationPanel({
  referralId,
  clarificationNotes,
  status,
  canRequest = true,
  canRespond = true,
}: ClarificationPanelProps) {
  const [question, setQuestion] = useState('');
  const [response, setResponse] = useState('');
  const requestMutation = useRequestClarification();
  const responseMutation = useAddClarificationResponse();

  const isInfoRequested = status === 'info_requested';

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>Clarification</Typography>

      {clarificationNotes && (
        <Alert severity="info" sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight="bold">Clarification received:</Typography>
          <Typography variant="body2">{clarificationNotes}</Typography>
        </Alert>
      )}

      {isInfoRequested && !clarificationNotes && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Clarification has been requested from the referrer. Awaiting response.
        </Alert>
      )}

      {canRequest && !isInfoRequested && (
        <Stack spacing={1} sx={{ mb: 2 }}>
          <TextField
            label="Request clarification from referrer"
            multiline
            rows={2}
            fullWidth
            size="small"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button
            variant="outlined"
            size="small"
            disabled={!question.trim() || requestMutation.isPending}
            onClick={() => {
              requestMutation.mutate({ referralId, question });
              setQuestion('');
            }}
          >
            Send Clarification Request
          </Button>
        </Stack>
      )}

      {canRespond && isInfoRequested && !clarificationNotes && (
        <Stack spacing={1}>
          <TextField
            label="Enter clarification information"
            multiline
            rows={3}
            fullWidth
            size="small"
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            helperText="Enter information received from the referrer or patient"
          />
          <Button
            variant="contained"
            size="small"
            disabled={!response.trim() || responseMutation.isPending}
            onClick={() => {
              responseMutation.mutate({ referralId, notes: response });
              setResponse('');
            }}
          >
            Add Clarification
          </Button>
        </Stack>
      )}
    </Box>
  );
}

import EmailIcon from '@mui/icons-material/Email';
import ForumIcon from '@mui/icons-material/Forum';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import SmsIcon from '@mui/icons-material/Sms';
import { Box, Button, Chip, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  AllCorrespondencePanel,
  LettersPanel,
  MessagesPanel,
  MessageThreadsPanel,
} from './CorrespondenceSections';

interface CorrespondenceTabProps {
  patientId: string;
}

export function CorrespondenceTab({ patientId }: CorrespondenceTabProps) {
  const [filter, setFilter] = useState<'all' | 'messages' | 'threads' | 'letters'>('all');
  const [composeMessage, setComposeMessage] = useState(false);
  const [composeLetter, setComposeLetter] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();
  const fromNoteId = searchParams.get('fromNoteId');
  useEffect(() => {
    if (fromNoteId) {
      setFilter('letters');
      setComposeLetter(true);
      const next = new URLSearchParams(searchParams);
      next.delete('fromNoteId');
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromNoteId]);

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={700} fontFamily="Albert Sans, sans-serif">Correspondence</Typography>
        {filter === 'letters' && (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              startIcon={<SmsIcon />}
              variant="outlined"
              size="small"
              onClick={() => setFilter('messages')}
              sx={{ textTransform: 'none', borderColor: '#327C8D', color: '#327C8D' }}
            >
              Send Patient Message
            </Button>
            <Button
              startIcon={<EmailIcon />}
              variant="contained"
              size="small"
              onClick={() => setComposeLetter(true)}
              sx={{ textTransform: 'none', bgcolor: '#b8621a', '&:hover': { bgcolor: '#d6741f' } }}
            >
              Compose Letter
            </Button>
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75, mb: 2 }}>
        {[
          { value: 'all' as const, label: 'All Activity', icon: <MergeTypeIcon sx={{ fontSize: 14 }} /> },
          { value: 'messages' as const, label: 'Messages', icon: <SmsIcon sx={{ fontSize: 14 }} /> },
          { value: 'threads' as const, label: 'Threads', icon: <ForumIcon sx={{ fontSize: 14 }} /> },
          { value: 'letters' as const, label: 'Letters', icon: <EmailIcon sx={{ fontSize: 14 }} /> },
        ].map((f) => (
          <Chip
            key={f.value}
            icon={f.icon}
            label={f.label}
            size="small"
            variant={filter === f.value ? 'filled' : 'outlined'}
            onClick={() => setFilter(f.value)}
            sx={{
              cursor: 'pointer',
              fontSize: 11,
              ...(filter === f.value ? { bgcolor: '#b8621a', color: '#fff', '& .MuiChip-icon': { color: '#fff' } } : {}),
            }}
          />
        ))}
      </Box>
      {filter === 'all' && <AllCorrespondencePanel patientId={patientId} />}
      {filter === 'messages' && <MessagesPanel patientId={patientId} />}
      {filter === 'threads' && (
        <MessageThreadsPanel
          patientId={patientId}
          composeOpen={composeMessage}
          onComposeClose={() => setComposeMessage(false)}
        />
      )}
      {filter === 'letters' && (
        <LettersPanel
          patientId={patientId}
          composeOpen={composeLetter}
          onComposeClose={() => setComposeLetter(false)}
          fromNoteId={fromNoteId}
        />
      )}
    </Box>
  );
}

export default CorrespondenceTab;

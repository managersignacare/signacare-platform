// features/messaging/pages/MessagingPage.tsx
import React, { useState } from 'react';
import { Box } from '@mui/material';
import { MessageThreadList } from '../components/MessageThreadList';
import { MessageComposer } from '../components/MessageComposer';
import { NewThreadDialog } from '../components/NewThreadDialog';
import { useAuthStore } from '../../../shared/store/authStore';
import type { MessageThreadResponse } from '../types/messagingTypes';

export default function MessagingPage(): React.ReactElement {
  const currentUser = useAuthStore((s) => s.user);
  const [selectedThread, setSelectedThread] = useState<MessageThreadResponse | null>(null);
  const [newThreadOpen, setNewThreadOpen] = useState(false);

  return (
    <Box
      sx={{
        display: 'flex',
        height: '100%',
        overflow: 'hidden',
        bgcolor: 'background.default',
      }}
    >
      {/* ── Left panel: thread list ── */}
      <MessageThreadList
        onSelectThread={setSelectedThread}
        onNewThread={() => setNewThreadOpen(true)}
        selectedThreadId={selectedThread?.id}
      />

      {/* ── Right panel: message view / empty state ── */}
      <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {selectedThread && currentUser ? (
          <MessageComposer
            threadId={selectedThread.id}
            threadSubject={selectedThread.subject}
            currentStaffId={currentUser.id}
          />
        ) : (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.secondary',
            }}
          >
            Select a conversation to view messages
          </Box>
        )}
      </Box>

      {/* ── New thread dialog ── */}
      <NewThreadDialog
        open={newThreadOpen}
        onClose={() => setNewThreadOpen(false)}
        onCreated={(thread) => {
          setNewThreadOpen(false);
          setSelectedThread(thread);
        }}
      />
    </Box>
  );
}

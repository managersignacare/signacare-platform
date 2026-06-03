import React, { useState } from 'react';
import {
  Box,
  Typography,
  List,
  ListItemButton,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Badge,
  Chip,
  TextField,
  InputAdornment,
  CircularProgress,
  Alert,
  Divider,
  Button,
  Tooltip,
  IconButton,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined';
import AddCommentOutlinedIcon from '@mui/icons-material/AddCommentOutlined';
import {
  useMessageThreads,
  useMarkThreadRead,
  useArchiveThread,
} from '../hooks/useMessages';
import type { MessageThreadResponseView as MessageThreadResponse } from '../types/messagingTypes';

const UNREAD_BADGE_COLOR = '#327C8D';

interface Props {
  patientId?: string;
  onSelectThread: (thread: MessageThreadResponse) => void;
  onNewThread: () => void;
  selectedThreadId?: string;
}

export const MessageThreadList: React.FC<Props> = ({
  patientId,
  onSelectThread,
  onNewThread,
  selectedThreadId,
}) => {
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const {
    data: threads,
    isLoading,
    isError,
  } = useMessageThreads({ patientId, isArchived: showArchived });

  const markReadMutation = useMarkThreadRead();
  const archiveMutation = useArchiveThread();

  const handleSelect = (thread: MessageThreadResponse) => {
    onSelectThread(thread);
    if (thread.unreadCount > 0) {
      markReadMutation.mutate(thread.id);
    }
  };

  const filtered = (threads ?? []).filter(
    (t) =>
      !search ||
      t.subject.toLowerCase().includes(search.toLowerCase()) ||
      (t.patientName ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ m: 2 }} />;
  if (isError)
    return (
      <Alert role="alert" severity="error" sx={{ m: 2 }}>
        Failed to load messages.
      </Alert>
    );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        borderRight: '1px solid',
        borderColor: 'divider',
        minWidth: 300,
        maxWidth: 380,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 2,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Typography variant="h6">Messages</Typography>
        <Tooltip title="New message">
          <IconButton onClick={onNewThread} size="small">
            <AddCommentOutlinedIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Search */}
      <Box sx={{ px: 2, pb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search messages…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
          }}
        />
      </Box>

      {/* Archive toggle */}
      <Box sx={{ px: 2, pb: 1 }}>
        <Button
          size="small"
          variant={showArchived ? 'contained' : 'outlined'}
          startIcon={<ArchiveOutlinedIcon />}
          onClick={() => setShowArchived((v) => !v)}
          sx={{ fontSize: 11 }}
        >
          {showArchived ? 'Show Active' : 'Show Archived'}
        </Button>
      </Box>

      <Divider />

      {/* Thread list */}
      {filtered.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          No messages found.
        </Typography>
      ) : (
        <List disablePadding sx={{ overflowY: 'auto', flex: 1 }}>
          {filtered.map((thread: MessageThreadResponse) => (
            <React.Fragment key={thread.id}>
              <ListItemButton
                selected={thread.id === selectedThreadId}
                onClick={() => handleSelect(thread)}
                sx={{
                  bgcolor:
                    thread.unreadCount > 0
                      ? `${UNREAD_BADGE_COLOR}10`
                      : undefined,
                  '&.Mui-selected': {
                    bgcolor: `${UNREAD_BADGE_COLOR}22`,
                  },
                  '&:hover': {
                    bgcolor: `${UNREAD_BADGE_COLOR}18`,
                  },
                  alignItems: 'flex-start',
                  py: 1.5,
                }}
              >
                <ListItemAvatar>
                  <Badge
                    badgeContent={thread.unreadCount}
                    sx={{
                      '& .MuiBadge-badge': {
                        bgcolor: UNREAD_BADGE_COLOR,
                        color: '#fff',
                      },
                    }}
                  >
                    <Avatar
                      sx={{
                        bgcolor: UNREAD_BADGE_COLOR,
                        width: 36,
                        height: 36,
                      }}
                    >
                      {(thread.createdByStaffName ?? '?').charAt(0).toUpperCase()}
                    </Avatar>
                  </Badge>
                </ListItemAvatar>
                <ListItemText
                  primary={
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 1,
                      }}
                    >
                      <Typography
                        variant="body2"
                        fontWeight={thread.unreadCount > 0 ? 700 : 400}
                        noWrap
                        sx={{ maxWidth: 180 }}
                      >
                        {thread.subject}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ whiteSpace: 'nowrap' }}
                      >
                        {thread.lastMessageAt
                          ? thread.lastMessageAt.split('T')[0]
                          : ''}
                      </Typography>
                    </Box>
                  }
                  secondary={
                    <Box>
                      {thread.patientName && (
                        <Chip
                          label={thread.patientName}
                          size="small"
                          sx={{ height: 16, fontSize: 10, mr: 0.5 }}
                        />
                      )}
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        component="span"
                      >
                        {thread.lastMessagePreview ?? ''}
                      </Typography>
                    </Box>
                  }
                />
                <Tooltip title="Archive thread">
                  <IconButton
                    size="small"
                    sx={{ ml: 0.5, mt: 0.5 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      archiveMutation.mutate(thread.id);
                    }}
                  >
                    <ArchiveOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </ListItemButton>
              <Divider component="li" />
            </React.Fragment>
          ))}
        </List>
      )}
    </Box>
  );
};
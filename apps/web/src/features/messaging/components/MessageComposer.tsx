import React, { useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Divider,
  Paper,
  Alert,
} from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useThreadMessages, useSendMessage } from '../hooks/useMessages';
import type { MessageResponseView as MessageResponse } from '../types/messagingTypes';

const ReplySchema = z.object({ body: z.string().min(1) });
type ReplyDTO = z.infer<typeof ReplySchema>;

interface Props {
  threadId: string;
  threadSubject: string;
  currentStaffId: string;
}

export const MessageComposer: React.FC<Props> = ({
  threadId,
  threadSubject,
  currentStaffId,
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: messages, isLoading, isError } = useThreadMessages(threadId);
  const sendMutation = useSendMessage(threadId);

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ReplyDTO>({
    resolver: zodResolver(ReplySchema),
    defaultValues: { body: '' },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const onSubmit = (data: ReplyDTO) => {
    sendMutation.mutate(
      { threadId, body: data.body },
      { onSuccess: () => reset() },
    );
  };

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ m: 2 }} />;
  if (isError)
    return <Alert role="alert" severity="error">Failed to load messages.</Alert>;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Thread header */}
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" noWrap>
          {threadSubject}
        </Typography>
      </Box>

      {/* Messages */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {messages?.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No messages yet.
          </Typography>
        )}
        {(messages ?? []).map((msg: MessageResponse) => {
          const isMine = msg.senderStaffId === currentStaffId;
          return (
            <Box
              key={msg.id}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isMine ? 'flex-end' : 'flex-start',
              }}
            >
              <Paper
                elevation={0}
                sx={{
                  px: 2,
                  py: 1,
                  maxWidth: '75%',
                  bgcolor: isMine ? 'primary.main' : 'grey.100',
                  color: isMine ? '#fff' : 'text.primary',
                  borderRadius: isMine
                    ? '16px 16px 4px 16px'
                    : '16px 16px 16px 4px',
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {msg.body}
                </Typography>
              </Paper>
              <Box sx={{ display: 'flex', gap: 1, mt: 0.25 }}>
                <Typography variant="caption" color="text.secondary">
                  {msg.senderStaffName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  · {msg.createdAt.replace('T', ' ').slice(0, 16)}
                </Typography>
              </Box>
            </Box>
          );
        })}
        <div ref={bottomRef} />
      </Box>

      {/* Reply composer */}
      <Divider />
      <Box
        component="form"
        onSubmit={handleSubmit(onSubmit)}
        sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'flex-end' }}
      >
        <Controller
          name="body"
          control={control}
          render={({ field }) => (
            <TextField
              {...field}
              placeholder="Write a reply…"
              fullWidth
              multiline
              maxRows={4}
              size="small"
              error={!!errors.body}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(onSubmit)();
                }
              }}
            />
          )}
        />
        <Button
          variant="contained"
          type="submit"
          disabled={sendMutation.isPending}
          sx={{ minWidth: 44, height: 40, p: 0 }}
        >
          {sendMutation.isPending ? (
            <CircularProgress role="progressbar" aria-label="Loading" size={18} color="inherit" />
          ) : (
            <SendIcon fontSize="small" />
          )}
        </Button>
      </Box>
    </Box>
  );
};
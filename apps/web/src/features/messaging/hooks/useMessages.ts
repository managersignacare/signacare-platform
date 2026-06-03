import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { messageApi } from '../services/messageApi';
import type { CreateThreadDTO, SendMessageDTO } from '../types/messagingTypes';
import { messagingKeys } from '../queryKeys';

export const useMessageThreads = (params: {
  patientId?: string;
  isArchived?: boolean;
}) =>
  useQuery({
    queryKey: messagingKeys.threads(params),
    queryFn: () => messageApi.listThreads(params),
    refetchInterval: 30_000, // poll every 30 s for new messages
  });

export const useMessageThread = (threadId: string) =>
  useQuery({
    queryKey: messagingKeys.thread(threadId),
    queryFn: () => messageApi.getThread(threadId),
    enabled: !!threadId,
  });

export const useThreadMessages = (threadId: string) =>
  useQuery({
    queryKey: messagingKeys.threadMessages(threadId),
    queryFn: () => messageApi.getThreadMessages(threadId),
    enabled: !!threadId,
    refetchInterval: 15_000,
  });

export const useTotalUnreadCount = () =>
  useQuery({
    queryKey: messagingKeys.unreadCount(),
    queryFn: () => messageApi.getTotalUnreadCount(),
    refetchInterval: 30_000,
  });

export const useCreateThread = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateThreadDTO) => messageApi.createThread(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.all }),
  });
};

export const useSendMessage = (threadId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: SendMessageDTO) => messageApi.sendMessage(dto),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: messagingKeys.thread(threadId) }),
  });
};

export const useMarkThreadRead = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => messageApi.markThreadRead(threadId),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.all }),
  });
};

export const useArchiveThread = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => messageApi.archiveThread(threadId),
    onSuccess: () => qc.invalidateQueries({ queryKey: messagingKeys.all }),
  });
};

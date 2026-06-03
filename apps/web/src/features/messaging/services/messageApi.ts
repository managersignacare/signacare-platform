import { apiClient } from '../../../shared/services/apiClient';
import type {
  MessageThreadResponseView as MessageThreadResponse,
  MessageResponseView as MessageResponse,
  CreateThreadDTO,
  SendMessageDTO,
} from '../types/messagingTypes';

export const messageApi = {
  listThreads: async (params: {
    patientId?: string;
    isArchived?: boolean;
  }): Promise<MessageThreadResponse[]> => {
    return apiClient.get('messages/threads', params);
  },

  getThread: async (threadId: string): Promise<MessageThreadResponse> => {
    return apiClient.get(`messages/threads/${threadId}`);
  },

  getThreadMessages: async (threadId: string): Promise<MessageResponse[]> => {
    return apiClient.get(
      `messages/threads/${threadId}/messages`,
    );
  },

  createThread: async (
    dto: CreateThreadDTO,
  ): Promise<MessageThreadResponse> => {
    return apiClient.post('messages/threads', dto);
  },

  sendMessage: async (dto: SendMessageDTO): Promise<MessageResponse> => {
    return apiClient.post(
      `messages/threads/${dto.threadId}/messages`,
      { body: dto.body },
    );
  },

  markThreadRead: async (threadId: string): Promise<void> => {
    await apiClient.patch(`messages/threads/${threadId}/read`);
  },

  archiveThread: async (threadId: string): Promise<void> => {
    await apiClient.patch(`messages/threads/${threadId}/archive`);
  },

  getTotalUnreadCount: async (): Promise<number> => {
    const res = await apiClient.get<{ count: number }>('messages/unread-count');
    return res.count;
  },
};

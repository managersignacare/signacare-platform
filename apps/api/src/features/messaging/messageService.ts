import type { Knex } from 'knex';
import * as messageRepo from './messageRepository';
import type {
  MessageCreateDTO,
  MessageResponse,
  MessageThreadCreateDTO,
  MessageThreadResponse,
} from '@signacare/shared';
import type { AuthContext } from '@signacare/shared';
import { createAutoContactRecord } from '../contacts/autoContactRecord';
import { withTenantContext } from '../../shared/tenantContext';

/**
 * BUG-602 — `conn` defaults to the request-scoped `db` proxy. Schedulers
 * running outside any request context MUST pass `dbAdmin`.
 */
export async function createThread(
  auth: AuthContext,
  dto: MessageThreadCreateDTO,
  conn?: Knex,
): Promise<MessageThreadResponse> {
  const thread = await messageRepo.createThread(auth.clinicId, auth.staffId, dto, conn);

  // Auto-create ABF contact record if thread is about a patient — awaited
  // so the contact is committed before the response reaches the client.
  const patientId = dto.patientId;
  if (patientId) {
    try {
      await withTenantContext(auth.clinicId, async () => {
        await createAutoContactRecord({
          clinicId: auth.clinicId,
          patientId,
          staffId: auth.staffId,
          sourceType: 'message',
          sourceId: thread.id,
          contactType: 'Non-face-to-face — Clinical documentation',
          briefSummary: `Message thread: ${dto.subject ?? 'No subject'}`,
        });
      });
    } catch { /* already logged inside createAutoContactRecord */ }
  }

  return thread;
}

export async function listThreads(
  auth: AuthContext,
  filters?: { patientId?: string; isArchived?: boolean },
): Promise<MessageThreadResponse[]> {
  return messageRepo.listThreads(auth.clinicId, auth.staffId, filters);
}

export async function getThread(
  auth: AuthContext,
  threadId: string,
): Promise<MessageThreadResponse> {
  return messageRepo.getThread(auth.clinicId, threadId, auth.staffId);
}

export async function getThreadMessages(
  auth: AuthContext,
  threadId: string,
): Promise<MessageResponse[]> {
  return messageRepo.getThreadMessages(auth.clinicId, threadId, auth.staffId);
}

export async function sendMessage(
  auth: AuthContext,
  dto: MessageCreateDTO,
): Promise<MessageResponse> {
  return messageRepo.sendMessage(auth.clinicId, auth.staffId, dto);
}

export async function getInbox(
  auth: AuthContext,
  unreadOnly: boolean,
): Promise<MessageResponse[]> {
  return messageRepo.getInbox(auth.clinicId, auth.staffId, unreadOnly);
}

export async function markAsRead(
  auth: AuthContext,
  messageId: string,
): Promise<void> {
  return messageRepo.markAsRead(auth.clinicId, messageId, auth.staffId);
}

export async function markThreadRead(
  auth: AuthContext,
  threadId: string,
): Promise<void> {
  return messageRepo.markThreadRead(auth.clinicId, threadId, auth.staffId);
}

export async function archiveThread(
  auth: AuthContext,
  threadId: string,
): Promise<void> {
  return messageRepo.archiveThread(auth.clinicId, threadId, auth.staffId);
}

export async function getUnreadCount(
  auth: AuthContext,
): Promise<number> {
  return messageRepo.getUnreadCount(auth.clinicId, auth.staffId);
}

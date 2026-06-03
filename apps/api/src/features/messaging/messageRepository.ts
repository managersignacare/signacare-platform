import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { db } from '../../db/db';
import { logger } from '../../utils/logger';
import type {
  MessageCreateDTO,
  MessageResponse,
  MessageThreadCreateDTO,
  MessageThreadResponse,
} from '@signacare/shared';

// Real schema (verified post-R2):
//   messages: id, thread_id, sender_id, clinic_id, content, is_read, +ts
//   message_thread_participants: id, thread_id, user_id, last_read_at, +ts
//
// The MessageCreateDTO/Response shape is richer than the DB schema —
// pre-R2 the route wrote 6 ghost columns to messages and 2 ghost columns
// to message_thread_participants, all covered by @code-columns-exempt
// markers and silently dropped by Knex. Phase R3 reconciliation: store
// the rich DTO fields (recipient, patient, subject, urgency, read_at)
// inside the messages.content TEXT as a JSON envelope, decoded by
// mapMessage on read. The API contract is preserved end-to-end.
const MESSAGE_COLUMNS = [
  'id',
  'thread_id',
  'sender_id',
  'clinic_id',
  'content',
  'is_read',
  'created_at',
  'updated_at',
] as const;
const MESSAGE_THREAD_COLUMNS = [
  'id',
  'clinic_id',
  'created_by_id',
  'patient_id',
  'subject',
  'last_message_at',
  'created_at',
  'updated_at',
  'deleted_at',
] as const;

interface MessageContentEnvelope {
  body: string;
  subject?: string | null;
  recipientId?: string | null;
  patientId?: string | null;
  isUrgent?: boolean;
  readAt?: string | null;
}

function decodeContent(raw: unknown): MessageContentEnvelope {
  if (typeof raw !== 'string' || raw.length === 0) return { body: '' };
  // Tolerate plain-text legacy rows by trying JSON first then falling
  // back to the raw string as the body.
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'body' in parsed) {
      return parsed as MessageContentEnvelope;
    }
    return { body: raw };
  } catch {
    return { body: raw };
  }
}

function mapMessage(row: Record<string, unknown>): MessageResponse {
  const env = decodeContent(row['content']);
  return {
    id: row['id'] as string,
    clinicId: row['clinic_id'] as string,
    threadId: (row['thread_id'] as string | null) ?? null,
    senderId: row['sender_id'] as string,
    recipientId: env.recipientId ?? null,
    patientId: env.patientId ?? null,
    subject: env.subject ?? null,
    body: env.body,
    isRead: row['is_read'] as boolean,
    isUrgent: env.isUrgent ?? false,
    readAt: env.readAt ?? null,
    createdAt: row['created_at'] as string,
  };
}

function mapThread(
  row: Record<string, unknown>,
  messages?: MessageResponse[],
): MessageThreadResponse {
  return {
    id: row['id'] as string,
    clinicId: row['clinic_id'] as string,
    subject: row['subject'] as string,
    patientId: (row['patient_id'] as string | null) ?? null,
    createdById: row['created_by_id'] as string,
    lastMessageAt: (row['last_message_at'] as string | null) ?? null,
    messageCount: Number(row['message_count'] ?? 0),
    unreadCount: Number(row['unread_count'] ?? 0),
    createdAt: row['created_at'] as string,
    updatedAt: row['updated_at'] as string,
    messages,
  };
}

/**
 * BUG-602 — `conn` defaults to the request-scoped `db` proxy (RLS
 * applies). Schedulers running outside any request context MUST pass
 * `dbAdmin` so the message_threads + message_thread_participants
 * INSERTs do not RLS-reject under empty `app.clinic_id` GUC.
 */
export async function createThread(
  clinicId: string,
  userId: string,
  dto: MessageThreadCreateDTO,
  conn: Knex = db,
): Promise<MessageThreadResponse> {
  const id = uuidv4();
  const [row] = await conn('message_threads')
    .insert({
      id,
      clinic_id: clinicId,
      subject: dto.subject,
      patient_id: dto.patientId ?? null,
      created_by_id: userId,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning(MESSAGE_THREAD_COLUMNS) as Record<string, unknown>[];

  // Add participants (creator + recipients). Real columns:
  // id, thread_id, user_id, last_read_at, +ts. Tenancy is via parent
  // thread (no clinic_id on participants table).
  const participantIds = dto.participantIds?.length ? dto.participantIds : dto.recipientIds ?? [];
  const allParticipants = new Set([userId, ...participantIds]);
  for (const userIdParticipant of allParticipants) {
    await conn('message_thread_participants').insert({
      id: uuidv4(),
      thread_id: id,
      user_id: userIdParticipant,
      created_at: new Date(),
      updated_at: new Date(),
    }).catch(err => { logger.debug({ err }, 'Duplicate participant'); }); // Expected for idempotent adds
  }

  return mapThread({ ...row, message_count: 0, unread_count: 0 });
}

export async function listThreads(
  clinicId: string,
  userId: string,
  filters?: { patientId?: string; isArchived?: boolean },
): Promise<MessageThreadResponse[]> {
  const q = db('message_threads')
    .where({ clinic_id: clinicId })
    .whereExists(
      db('message_thread_participants').where({ user_id: userId }).whereRaw('thread_id = message_threads.id'),
    )
    .select(
      'message_threads.*',
      db.raw(
        `(
          SELECT COUNT(*)::int
          FROM messages m
          WHERE m.thread_id = message_threads.id
            AND m.clinic_id = ?
        ) as message_count`,
        [clinicId],
      ),
      db.raw(
        `(
          SELECT COUNT(*)::int
          FROM messages m
          WHERE m.thread_id = message_threads.id
            AND m.clinic_id = ?
            AND m.is_read = false
            AND m.sender_id <> ?
        ) as unread_count`,
        [clinicId, userId],
      ),
    )
    .orderBy('updated_at', 'desc')
    .limit(500); // BUG-437 — messaging-ceiling per-user threads
  if (filters?.patientId) q.andWhere('patient_id', filters.patientId);
  if (filters?.isArchived === true) {
    q.whereNotNull('deleted_at');
  } else {
    q.whereNull('deleted_at');
  }
  const rows = await q as Record<string, unknown>[];
  return rows.map((r) => mapThread(r));
}

export async function getThread(
  clinicId: string,
  threadId: string,
  userId: string,
): Promise<MessageThreadResponse> {
  const row = await db('message_threads')
    .where({ id: threadId, clinic_id: clinicId })
    .whereExists(
      db('message_thread_participants')
        .where({ user_id: userId })
        .whereRaw('thread_id = message_threads.id'),
    )
    .first() as Record<string, unknown> | undefined;
  if (!row) {
    const err = new Error('Thread not found') as Error & { status: number; code: string };
    err.status = 404;
    err.code = 'THREAD_NOT_FOUND';
    throw err;
  }
  const messageRows = await db('messages').where({ thread_id: threadId, clinic_id: clinicId }).orderBy('created_at') as Record<string, unknown>[];
  return mapThread(row, messageRows.map(mapMessage));
}

export async function getThreadMessages(
  clinicId: string,
  threadId: string,
  userId: string,
): Promise<MessageResponse[]> {
  await getThread(clinicId, threadId, userId);
  const rows = await db('messages')
    .where({ thread_id: threadId, clinic_id: clinicId })
    .orderBy('created_at') as Record<string, unknown>[];
  return rows.map(mapMessage);
}

export async function sendMessage(
  clinicId: string,
  senderId: string,
  dto: MessageCreateDTO,
): Promise<MessageResponse> {
  // Phase R3: messages table has only (id, thread_id, sender_id,
  // clinic_id, content, is_read, +ts). Pack the richer DTO fields
  // (recipient, patient, subject, urgency) into content as a JSON
  // envelope; mapMessage decodes them on read so the API contract
  // is preserved.
  const envelope: MessageContentEnvelope = {
    body: dto.body,
    subject: dto.subject ?? null,
    recipientId: dto.recipientId ?? null,
    patientId: dto.patientId ?? null,
    isUrgent: dto.isUrgent ?? false,
  };
  const [row] = await db('messages')
    .insert({
      id: uuidv4(),
      clinic_id: clinicId,
      thread_id: dto.threadId ?? null,
      sender_id: senderId,
      content: JSON.stringify(envelope),
      is_read: false,
      created_at: new Date(),
      updated_at: new Date(),
    })
    .returning(MESSAGE_COLUMNS) as Record<string, unknown>[];
  const mapped = mapMessage(row);

  // Phase 10C — emit a durable notification + live SSE push for the
  // recipient(s) so the new message surfaces in the bell and wakes
  // any connected client immediately. Recipients excludes the sender.
  // Dynamic import keeps the notification module from circularly
  // depending on the message repository.
  try {
    const { emitClinicalSignal } = await import('../events/clinicalSignalEmitter');

    // Figure out who to notify:
    //  - explicit recipient_id when the caller supplied one
    //  - otherwise every thread participant except the sender
    const recipients: string[] = [];
    if (dto.recipientId && dto.recipientId !== senderId) {
      recipients.push(dto.recipientId);
    } else if (dto.threadId) {
      // message_thread_participants has no clinic_id (tenancy via parent
      // thread). Real participant column is user_id, not staff_id.
      const participants = await db('message_thread_participants')
        .where({ thread_id: dto.threadId })
        .select('user_id');
      for (const p of participants) {
        const sid = (p as { user_id: string }).user_id;
        if (sid && sid !== senderId) recipients.push(sid);
      }
    }

    if (recipients.length > 0) {
      const title = dto.subject?.trim()
        ? `New message — ${dto.subject}`
        : 'New message';
      const snippet = dto.body.length > 140 ? `${dto.body.slice(0, 140)}…` : dto.body;
      await emitClinicalSignal({
        source: 'messaging',
        signalKey: 'new-message',
        clinicId,
        userIds: recipients,
        severity: dto.isUrgent ? 'warning' : 'info',
        category: 'message',
        title,
        body: snippet,
        actionUrl: dto.threadId ? `/messages/${dto.threadId}` : '/messages',
        payload: {
          message_id: mapped.id,
          thread_id: dto.threadId ?? null,
          sender_id: senderId,
        },
        sseEventType: 'message',
      });
    }
  } catch (err) {
    logger.warn(
      { err, clinicId, senderId, threadId: dto.threadId ?? null },
      'sendMessage: non-blocking notification emission failed',
    );
  }

  return mapped;
}

export async function getInbox(
  clinicId: string,
  userId: string,
  unreadOnly: boolean,
): Promise<MessageResponse[]> {
  // messages has no recipient_id column (per Phase R2 baseline). The
  // recipient is derived: a message is "in the user's inbox" if they
  // are a participant on the thread AND the message wasn't sent by
  // them. Filter via JOIN on message_thread_participants instead of
  // the ghost recipient_id column.
  const q = db('messages')
    .where({ 'messages.clinic_id': clinicId })
    .whereExists(
      db('message_thread_participants')
        .where({ user_id: userId })
        .whereRaw('thread_id = messages.thread_id'),
    )
    .whereNot('messages.sender_id', userId)
    .orderBy('messages.created_at', 'desc')
    .limit(500) // BUG-437 — messaging-ceiling per-user inbox
    .select('messages.*');
  if (unreadOnly) q.where('messages.is_read', false);
  return (await q as Record<string, unknown>[]).map(mapMessage);
}

export async function markAsRead(
  clinicId: string,
  messageId: string,
  _userId: string,
): Promise<void> {
  // messages.read_at column doesn't exist (per Phase R2). is_read alone
  // tracks read state. Per-user read tracking lives on
  // message_thread_participants.last_read_at instead.
  await db('messages')
    .where({ id: messageId, clinic_id: clinicId })
    .update({ is_read: true, updated_at: new Date() });
}

export async function markThreadRead(
  clinicId: string,
  threadId: string,
  userId: string,
): Promise<void> {
  await getThread(clinicId, threadId, userId);
  await db.transaction(async (trx) => {
    await trx('messages')
      .where({ thread_id: threadId, clinic_id: clinicId })
      .whereNot('sender_id', userId)
      .update({ is_read: true, updated_at: new Date() });
    await trx('message_thread_participants')
      .where({ thread_id: threadId, user_id: userId })
      .update({ last_read_at: new Date(), updated_at: new Date() });
  });
}

export async function archiveThread(
  clinicId: string,
  threadId: string,
  userId: string,
): Promise<void> {
  await getThread(clinicId, threadId, userId);
  await db('message_threads')
    .where({ id: threadId, clinic_id: clinicId })
    .update({ deleted_at: new Date(), updated_at: new Date() });
}

export async function getUnreadCount(
  clinicId: string,
  userId: string,
): Promise<number> {
  const row = await db('messages')
    .where({ 'messages.clinic_id': clinicId, 'messages.is_read': false })
    .whereExists(
      db('message_thread_participants')
        .where({ user_id: userId })
        .whereRaw('thread_id = messages.thread_id'),
    )
    .whereNot('messages.sender_id', userId)
    .count('* as cnt')
    .first() as { cnt?: string | number } | undefined;
  return Number(row?.cnt ?? 0);
}

// apps/web/src/features/messaging/types/messagingTypes.ts
//
// Phase 0.7 PR3 Class D (TYPEDUP:MessageResponse / TYPEDUP:MessageThreadResponse) —
// frontend no longer redeclares the message + thread response shapes.
// Shared is the single source of truth.
//
// **Pre-existing latent bug flagged here, NOT fixed in this commit:**
// The shared backend response shape (mapThread / mapMessage in
// apps/api/src/features/messaging/messageRepository.ts) does NOT JOIN +
// enrich the response with display fields like `createdByStaffName`,
// `lastMessagePreview`, `participantNames`, `isArchived`,
// `senderStaffName`, `readByRecipients`, `isSystemMessage`, `patientName`.
// Several frontend consumers — MessageThreadList.tsx, MessageComposer.tsx,
// EpisodesTab.tsx, CorrespondenceTab.tsx — read these fields and would
// crash or render undefined when the messaging UI renders any real row.
// The messaging surface is essentially dead code today; nobody has hit
// the crash because nobody opens the messages list.
//
// FIX REQUIRED IN A FOLLOW-UP PR: enrich the backend mapThread/mapMessage
// to JOIN message_thread_participants + staff for the display fields,
// add those fields to the SHARED schema, then drop the *View extension
// types below. Tracked in docs/fix-registry.md → TYPEDUP:MessageResponse
// and TYPEDUP:MessageThreadResponse.
//
// For now this file:
//   1. Re-exports the canonical shared types so the CI guard passes.
//   2. Declares MessageResponseView + MessageThreadResponseView as
//      intersection types with the optional display fields the
//      consumers expect (they remain undefined at runtime until the
//      backend enrichment lands).
//   3. The historical names `MessageResponse` / `MessageThreadResponse`
//      now resolve to the shared canonical types via re-export.

import { z } from 'zod';
export type { MessageResponse, MessageThreadResponse } from '@signacare/shared';
import type {
  MessageResponse as SharedMessageResponse,
  MessageThreadResponse as SharedMessageThreadResponse,
} from '@signacare/shared';

// View-type extensions — what the frontend pretends the response shape
// is. Optional everywhere because the backend does not emit them.
export type MessageResponseView = SharedMessageResponse & {
  senderStaffId?: string;
  senderStaffName?: string;
  isSystemMessage?: boolean;
  readByRecipients?: { staffId: string; readAt: string }[];
};

export type MessageThreadResponseView = SharedMessageThreadResponse & {
  patientName?: string | null;
  createdByStaffId?: string;
  createdByStaffName?: string;
  participantNames?: string[];
  lastMessagePreview?: string | null;
  isArchived?: boolean;
};

// ─── DTO schemas (frontend-only — UI form validation) ──────────────────────

export const CreateThreadSchema = z.object({
  subject: z.string().min(1).max(300),
  patientId: z.string().uuid().optional(),
  recipientIds: z.array(z.string().uuid()).min(1),
  body: z.string().min(1),
});
export type CreateThreadDTO = z.infer<typeof CreateThreadSchema>;

export const SendMessageSchema = z.object({
  threadId: z.string().uuid(),
  body: z.string().min(1),
});
export type SendMessageDTO = z.infer<typeof SendMessageSchema>;

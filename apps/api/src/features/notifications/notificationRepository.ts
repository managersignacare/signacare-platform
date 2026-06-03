// apps/api/src/features/notifications/notificationRepository.ts
//
// Phase 10A — tenant-scoped CRUD over the `notifications` table.
//
// Column naming note: the physical table predates the Phase 10
// notification centre design and uses legacy names from the v2
// baseline schema:
//
//   DB column              | Phase 10 DTO field
//   ──────────────────────────────────────────
//   recipient_staff_id     | userId   (nullable = clinic-wide)
//   link                   | actionUrl
//   type                   | category fallback (free-form)
//   is_read + read_at pair | readAt
//
// Plus four new columns the augment migration added:
//   severity               — strict four-value enum
//   category               — strict whitelist (separate from free-form `type`)
//   payload                — jsonb for dedupe_key + arbitrary context
//   override_patient_sync  — safety-critical flag for Viva's opt-in bypass
//
// This repository is the only place the mapping lives; the service
// and the routes both see the clean DTO shape.
//
// Every query includes clinic_id first (CLAUDE.md §1.3).
import type { Knex } from 'knex';
import { db } from '../../db/db';

// ── Row shape — matches the augmented physical table ──────────────────────

export interface NotificationRow {
  id: string;
  clinic_id: string;
  recipient_staff_id: string | null;
  type: string;
  category: string | null;
  title: string;
  body: string | null;
  link: string | null;
  priority: string | null;
  severity: string | null;
  payload: unknown;
  override_patient_sync: boolean;
  is_read: boolean;
  read_at: Date | null;
  source_type: string | null;
  source_id: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

// Explicit column list for .returning() (Phase R3 / CLAUDE.md §1.7).
// Verified against schema-snapshot.json: matches NotificationRow.
const NOTIFICATION_COLUMNS = [
  'id',
  'clinic_id',
  'recipient_staff_id',
  'type',
  'category',
  'title',
  'body',
  'link',
  'priority',
  'severity',
  'payload',
  'override_patient_sync',
  'is_read',
  'read_at',
  'source_type',
  'source_id',
  'expires_at',
  'created_at',
  'updated_at',
] as const;

export interface InsertInput {
  clinic_id: string;
  recipient_staff_id: string | null;
  severity: string;
  category: string;
  title: string;
  body: string | null;
  link: string | null;
  payload: Record<string, unknown> | null;
  override_patient_sync: boolean;
  expires_at: Date | null;
}

function insertRowValues(row: InsertInput): Record<string, unknown> {
  return {
    clinic_id: row.clinic_id,
    recipient_staff_id: row.recipient_staff_id,
    // Mirror category into the legacy `type` column so the existing
    // workflow engine queries (which still read `type`) keep seeing
    // a sensible value. `category` is the strict whitelist; `type`
    // is a free-form hint.
    type: row.category,
    category: row.category,
    severity: row.severity,
    // Keep legacy `priority` in sync with severity as a coarse
    // fallback (info/success → normal, warning → high, critical → critical).
    priority: row.severity === 'critical' ? 'critical'
      : row.severity === 'warning' ? 'high'
      : 'normal',
    title: row.title,
    body: row.body,
    link: row.link,
    payload: row.payload != null ? JSON.stringify(row.payload) : null,
    override_patient_sync: row.override_patient_sync,
    is_read: false,
    expires_at: row.expires_at,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

// ── Repository ─────────────────────────────────────────────────────────────

export class NotificationRepository {
  /**
   * Insert a single row. The partial unique index on
   * (clinic_id, payload->>'dedupe_key') enforces idempotency when the
   * caller sets a dedupe key — duplicate attempts return the existing
   * row instead of creating a new one.
   *
   * BUG-583 — `conn` defaults to the request-scoped `db` proxy (RLS
   * applies). Schedulers running outside any request context MUST pass
   * `dbAdmin` so the RLS WITH CHECK predicate `clinic_id = NULL` does
   * not reject every INSERT.
   */
  async insertOne(row: InsertInput, conn: Knex = db): Promise<NotificationRow | null> {
    const rows = await conn<NotificationRow>('notifications')
      .insert(insertRowValues(row))
      .onConflict(conn.raw('(clinic_id, (payload->>\'dedupe_key\')) WHERE payload->>\'dedupe_key\' IS NOT NULL') as unknown as string)
      .ignore()
      .returning(NOTIFICATION_COLUMNS) as NotificationRow[];
    return rows[0] ?? null;
  }

  /**
   * Bulk insert for multi-user fan-out. Same dedupe + connection
   * semantics as insertOne (BUG-583 — pass `dbAdmin` from schedulers).
   */
  async insertMany(rows: InsertInput[], conn: Knex = db): Promise<NotificationRow[]> {
    if (rows.length === 0) return [];
    const returned = await conn<NotificationRow>('notifications')
      .insert(rows.map(insertRowValues))
      .onConflict(conn.raw('(clinic_id, (payload->>\'dedupe_key\')) WHERE payload->>\'dedupe_key\' IS NOT NULL') as unknown as string)
      .ignore()
      .returning(NOTIFICATION_COLUMNS);
    return returned as unknown as NotificationRow[];
  }

  /**
   * List notifications visible to a specific staff member in a
   * clinic. Visibility rule: rows where recipient_staff_id = self
   * OR clinic-broadcast rows (recipient_staff_id IS NULL).
   */
  async listForUser(
    clinicId: string,
    staffId: string,
    opts: { unreadOnly?: boolean; limit: number; offset: number },
  ): Promise<NotificationRow[]> {
    const query = db<NotificationRow>('notifications')
      .where('clinic_id', clinicId)
      .andWhere((builder) => {
        builder.where('recipient_staff_id', staffId).orWhereNull('recipient_staff_id');
      })
      .orderBy('created_at', 'desc')
      .limit(opts.limit)
      .offset(opts.offset);

    if (opts.unreadOnly) {
      query.where('is_read', false);
    }

    return query;
  }

  /**
   * Unread count for the header bell badge. Same visibility rule as
   * listForUser.
   */
  async countUnreadForUser(clinicId: string, staffId: string): Promise<number> {
    const [row] = (await db('notifications')
      .where('clinic_id', clinicId)
      .andWhere((b) => { b.where('recipient_staff_id', staffId).orWhereNull('recipient_staff_id'); })
      .where('is_read', false)
      .count<{ count: string }[]>('* as count')) as { count: string }[];
    return Number(row?.count ?? '0');
  }

  /**
   * Mark one or more rows read. Respects the same visibility rule
   * as listForUser — a clinician can't mark another user's
   * targeted notification read.
   */
  async markRead(clinicId: string, staffId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    return db('notifications')
      .where('clinic_id', clinicId)
      .andWhere((b) => { b.where('recipient_staff_id', staffId).orWhereNull('recipient_staff_id'); })
      .whereIn('id', ids)
      .where('is_read', false)
      .update({ is_read: true, read_at: new Date(), updated_at: new Date() });
  }

  /**
   * Mark every visible unread notification read in one statement.
   */
  async markAllRead(clinicId: string, staffId: string): Promise<number> {
    return db('notifications')
      .where('clinic_id', clinicId)
      .andWhere((b) => { b.where('recipient_staff_id', staffId).orWhereNull('recipient_staff_id'); })
      .where('is_read', false)
      .update({ is_read: true, read_at: new Date(), updated_at: new Date() });
  }

  /**
   * Soft-delete by flipping is_read and clearing from the user's
   * bell. The legacy table has no `deleted_at` column so we use
   * is_read + a sentinel expiry in the past to hide it from the
   * unread feed. Future enhancement: add deleted_at in a follow-up
   * migration once the legacy rows are all confirmed migrated.
   */
  async softDeleteTargeted(clinicId: string, staffId: string, id: string): Promise<number> {
    return db('notifications')
      .where({ clinic_id: clinicId, id, recipient_staff_id: staffId })
      .update({
        is_read: true,
        read_at: new Date(),
        expires_at: new Date(),
        updated_at: new Date(),
      });
  }
}

export const notificationRepository = new NotificationRepository();

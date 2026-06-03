import { Knex } from 'knex';

/**
 * BUG-553 — Add cancellation-audit columns to `prescriptions`.
 *
 * Why: prescription cancellation today persists `status='cancelled'` only.
 * The audit_log row captures `oldData/newData` shape but the *reason* for
 * cancellation is never preserved. AHPRA Standard 1 + S8 SafeScript audit
 * chain require a forensic record of *why* a controlled-drug script was
 * cancelled (sibling pattern of BUG-371b's `medication_cease_reason` /
 * `medication_cease_at`). This migration brings prescription-cancel to
 * parity with medication-cease.
 *
 * Columns:
 *   - cancellation_reason TEXT NULL — free-text reason (1..500 chars
 *     enforced at Zod boundary; NULL allowed only for legacy rows
 *     pre-migration so down() is a clean drop without orphaning data)
 *   - cancelled_at TIMESTAMPTZ NULL — set when service.cancel runs;
 *     redundant with audit_log.created_at but keeps the SoT inline on the
 *     prescription row for reporting/joins
 *   - cancelled_by_staff_id UUID NULL — FK staff(id) ON DELETE SET NULL
 *     (preserve audit trail even if staff record is later deactivated;
 *     same posture as `prescribed_by_staff_id` precedent)
 *
 * Backfill: NONE. Pre-existing cancelled rows keep NULL — Zod-required
 * reason applies to NEW cancellations only. The catalogue / forensic
 * dashboard MUST treat NULL as "pre-BUG-553 cancellation, reason not
 * captured" rather than "cancellation without reason".
 *
 * No CHECK constraint on cancellation_reason length — Zod L1 enforces
 * 1..500 chars at the API boundary; DB-level enforcement would block
 * legitimate dbAdmin / migration backfills if a future operator needed
 * to fill in a reason longer than 500 chars (compliance disclosure).
 */
export async function up(knex: Knex): Promise<void> {
  const hasCancellationReason = await knex.schema.hasColumn(
    'prescriptions',
    'cancellation_reason',
  );
  const hasCancelledAt = await knex.schema.hasColumn('prescriptions', 'cancelled_at');
  const hasCancelledByStaffId = await knex.schema.hasColumn(
    'prescriptions',
    'cancelled_by_staff_id',
  );

  await knex.schema.alterTable('prescriptions', (t) => {
    if (!hasCancellationReason) {
      t.text('cancellation_reason').nullable();
    }
    if (!hasCancelledAt) {
      t.timestamp('cancelled_at', { useTz: true }).nullable();
    }
    if (!hasCancelledByStaffId) {
      t.uuid('cancelled_by_staff_id').nullable().references('id').inTable('staff').onDelete('SET NULL');
      t.index(['cancelled_by_staff_id']);
    }
  });
}

export async function down(knex: Knex): Promise<void> {
  const hasCancellationReason = await knex.schema.hasColumn(
    'prescriptions',
    'cancellation_reason',
  );
  const hasCancelledAt = await knex.schema.hasColumn('prescriptions', 'cancelled_at');
  const hasCancelledByStaffId = await knex.schema.hasColumn(
    'prescriptions',
    'cancelled_by_staff_id',
  );

  await knex.schema.alterTable('prescriptions', (t) => {
    if (hasCancelledByStaffId) {
      t.dropIndex(['cancelled_by_staff_id']);
      t.dropColumn('cancelled_by_staff_id');
    }
    if (hasCancelledAt) t.dropColumn('cancelled_at');
    if (hasCancellationReason) t.dropColumn('cancellation_reason');
  });
}

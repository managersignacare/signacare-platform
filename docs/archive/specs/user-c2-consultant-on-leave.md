# SPIKE — USER-C.2 consultant-on-leave forward / reassign workflow

**Status:** design complete; implementation deferred to its own wave (est. 4-6 commits).
**Owner:** Wave A-5-USER Sub-cluster C.
**Blocked by:** none — all prerequisites already in schema.

## Problem

User report: "Consultant-on-leave: forward / reassign vetting workflow". When a consultant goes on leave, their active patients need to be temporarily reassigned to a covering clinician, and the reassignment must be vetted (approved/rejected by admin) before it becomes effective. Today the system has no first-class "staff on leave" concept — leave is informal, reassignment is manual, and there's no audit trail of who was covering for whom during a given window.

## Schema additions

### 1. `staff_leave_periods`

```typescript
await knex.schema.createTable('staff_leave_periods', (t) => {
  t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
  t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
  t.uuid('staff_id').notNullable().references('id').inTable('staff').onDelete('CASCADE');
  t.date('start_date').notNullable();
  t.date('end_date');                           // NULL = open-ended
  t.string('leave_type', 40).notNullable();     // 'annual' / 'sick' / 'study' / 'other'
  t.text('notes');
  t.uuid('recorded_by_id').references('id').inTable('staff').onDelete('SET NULL');
  t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at', { useTz: true });
  t.index(['clinic_id']);
  t.index(['staff_id']);
  t.index(['clinic_id', 'start_date', 'end_date'], 'idx_staff_leave_active_window');
});
// @migration-raw-exempt: check_constraint
await knex.raw(`
  ALTER TABLE staff_leave_periods
    ADD CONSTRAINT staff_leave_dates_chronological
    CHECK (end_date IS NULL OR end_date >= start_date)
`);
// @migration-raw-exempt: rls_policy
await knex.raw(`
  ALTER TABLE staff_leave_periods ENABLE ROW LEVEL SECURITY;
  CREATE POLICY rls_staff_leave_periods_tenant ON staff_leave_periods
    FOR ALL
    USING (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid)
    WITH CHECK (clinic_id = NULLIF(current_setting('app.clinic_id', true), '')::uuid);
`);
```

### 2. `reassignment_proposals`

```typescript
await knex.schema.createTable('reassignment_proposals', (t) => {
  t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
  t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');
  t.uuid('leave_period_id').notNullable().references('id').inTable('staff_leave_periods').onDelete('CASCADE');
  t.uuid('patient_id').notNullable().references('id').inTable('patients').onDelete('CASCADE');
  t.uuid('episode_id').references('id').inTable('episodes').onDelete('SET NULL');
  t.uuid('from_staff_id').notNullable().references('id').inTable('staff');
  t.uuid('to_staff_id').notNullable().references('id').inTable('staff');
  t.string('proposal_status', 20).notNullable().defaultTo('pending');  // pending / approved / rejected / expired
  t.text('vetted_reason');
  t.uuid('vetted_by_id').references('id').inTable('staff');
  t.timestamp('vetted_at', { useTz: true });
  t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at', { useTz: true });
  t.index(['clinic_id']);
  t.index(['leave_period_id']);
  t.index(['patient_id']);
  t.index(['proposal_status']);
});
// @migration-raw-exempt: check_constraint
await knex.raw(`
  ALTER TABLE reassignment_proposals
    ADD CONSTRAINT reassignment_status_check
    CHECK (proposal_status IN ('pending','approved','rejected','expired'))
`);
// @migration-raw-exempt: rls_policy
await knex.raw(`
  ALTER TABLE reassignment_proposals ENABLE ROW LEVEL SECURITY;
  CREATE POLICY rls_reassignment_proposals_tenant ON reassignment_proposals ...
`);
```

## Backend endpoints

1. `GET  /api/v1/staff-leave?staffId=&activeOnly=true` — list leave periods
2. `POST /api/v1/staff-leave` — record new leave (admin only; `staff:update`)
3. `PATCH /api/v1/staff-leave/:id` — edit dates / end-leave-early
4. `DELETE /api/v1/staff-leave/:id` — remove entry (cancel planned leave)
5. `GET  /api/v1/staff-leave/:leaveId/proposals` — list auto-generated reassignment proposals
6. `POST /api/v1/staff-leave/:leaveId/proposals` — auto-seed proposals for every patient currently under the on-leave staff member
7. `PATCH /api/v1/reassignment-proposals/:id` — approve / reject (admin only)

When a proposal is `approved`, a service-layer method updates `patient_team_assignments.primary_clinician_id` (episode-scoped if `episode_id` is set) and writes an `audit_log` row with `action='REASSIGNMENT_APPROVED'` linking leave_period_id.

## Frontend surfaces

1. **Staff settings → Leave tab** — list + create leave periods (admin only).
2. **Patient list Consultant column** — show 🏖 on-leave badge when the consultant has an active leave period covering today; tooltip shows cover's name if a proposal is approved.
3. **New admin page `/admin/reassignments`** — queue of `pending` proposals, with Approve / Reject action buttons; shows patient + episode + from → to.

## Tests

- Integration: staff-leave CRUD + proposal auto-seed + approve flow (5 tests).
- Unit: date-range overlap helper for "is staff on leave today".
- E2E (Playwright): admin records leave → proposal queue populates → approve → patient list shows new primary clinician (1 test).

## CI guards

- No new guards needed — existing `check-row-interface-matches-db` covers the new row types once snapshot is regenerated.

## Fix-registry (when shipped)

- `R-FIX-STAFF-LEAVE-PERIODS` (migration)
- `R-FIX-REASSIGNMENT-PROPOSALS` (migration)
- `R-FIX-STAFF-LEAVE-ROUTES` (routes file)

## Why spike, not build, in Sub-cluster C

1. Two new tables with RLS + CHECK constraints + backfill triggers — substantial schema work.
2. New admin UI (list + queue) — ~3-4 component files.
3. Service-layer method that rewrites team assignments — must pass L3 + L4 review because it changes clinical responsibility records.
4. Integration tests + E2E — at least 8 tests before ship.

Fits a 4-6 commit dedicated sub-cluster; shoehorning into the current USER batch dilutes review quality.

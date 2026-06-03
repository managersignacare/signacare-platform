// apps/api/migrations/20260424000002_pathology_orders_unique_order_number.ts
//
// BUG-262-UC (L3 follow-up to BUG-262) — add `UNIQUE (clinic_id,
// order_number)` to `pathology_orders`. The `findOrderByNumberAdmin`
// repo method uses `.first()` with the expectation that a given
// (clinic_id, order_number) maps to at most one row. Before this
// migration, the baseline had only a plain `t.index(['order_number'])`
// which enforced no uniqueness. Collision probability was
// astronomically low given the UUID-suffix `generateOrderNumber()`
// format, but CLAUDE.md §7.2 (Business uniqueness rules must have
// database constraints) was unmet.
//
// Safe on existing data: `generateOrderNumber()` at
// apps/api/src/features/pathology/pathologyService.ts:40 produces
// `PATH-{yyyymmdd}-{UUID8}` which guarantees uniqueness at the
// UUID-suffix level; no backfill required.

import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pathology_orders', (t) => {
    t.unique(['clinic_id', 'order_number'], { indexName: 'pathology_orders_clinic_order_number_unique' });
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('pathology_orders', (t) => {
    t.dropUnique(['clinic_id', 'order_number'], 'pathology_orders_clinic_order_number_unique');
  });
}

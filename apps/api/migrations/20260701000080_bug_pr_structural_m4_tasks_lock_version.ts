/*
 * BUG-ARCH-LOCK-VERSION-COVERAGE (M4 structural)
 *
 * Add lock_version to tasks to prevent silent lost updates across
 * concurrent clinician/team-manager edits.
 *
 * Mutation surfaces sharing this row:
 *  - PATCH /tasks/:taskId (status/assignee/priority/title updates)
 *  - task completion/uncompletion toggles
 *  - assignment updates from team workflows
 *
 * Repository update path now routes through updateWithOptimisticLock,
 * using row lock_version read from the current task record.
 */

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const has = await knex.schema.hasColumn('tasks', 'lock_version');
  if (!has) {
    await knex.schema.alterTable('tasks', (t) => {
      t.integer('lock_version').notNullable().defaultTo(1);
    });
  }
}

export async function down(_knex: Knex): Promise<void> {
  // @migration-down-noop: append-only policy (CLAUDE.md migration discipline).
}

/**
 * scripts/generate-types/replayer.ts
 *
 * Phase 0b.1b-i — extracted from `scripts/generate-types-from-migrations.ts`
 * per L5 0b.1a advisory #2 (god-file split). Pure function (no I/O); replay
 * logic itself is unchanged from pre-split. Re-export contract verified
 * via the umbrella test suite — see fix-registry rows + commit body.
 *
 * RESPONSIBILITY: replay parsed migration events in chronological filename
 * order to build per-table column maps. Handles createTable / alterTable /
 * dropTable + createTable-after-dropTable resurrection.
 */

import { type ColumnDef, type ParseEvent, parseBuilderBody } from './parser';

export interface TableState {
  readonly name: string;
  readonly columns: Map<string, ColumnDef>; // ordered by insertion
  readonly droppedFromMigrations: string[]; // filenames where columns were dropped
}

export function replayMigrations(eventsByMigration: Map<string, ParseEvent[]>): Map<string, TableState> {
  const tables = new Map<string, TableState>();
  // Process migrations in chronological order (sorted filenames).
  const sortedFiles = Array.from(eventsByMigration.keys()).sort();
  for (const file of sortedFiles) {
    const events = eventsByMigration.get(file)!;
    for (const ev of events) {
      // Phase 0b.1a cycle-2: dropTable removes the table entirely. Subsequent
      // createTable on the same name resets the state to an empty fresh table.
      if (ev.kind === 'dropTable') {
        tables.delete(ev.tableName);
        continue;
      }
      const { columnAdds, columnDrops, columnRenames } = parseBuilderBody(ev.bodySource);
      let state = tables.get(ev.tableName);
      if (!state) {
        if (ev.kind === 'createTable') {
          state = { name: ev.tableName, columns: new Map(), droppedFromMigrations: [] };
          tables.set(ev.tableName, state);
        } else {
          // alterTable on a table we've never seen (or one that was dropped) — skip.
          continue;
        }
      } else if (ev.kind === 'createTable') {
        // createTable on an existing table = drop-then-create (rare; the
        // migration author has already dropTableIfExists'd it). Reset state.
        state = { name: ev.tableName, columns: new Map(), droppedFromMigrations: [] };
        tables.set(ev.tableName, state);
      }
      for (const col of columnAdds) state.columns.set(col.name, col);
      for (const drop of columnDrops) {
        state.columns.delete(drop);
        (state.droppedFromMigrations as string[]).push(file);
      }
      for (const ren of columnRenames) {
        const existing = state.columns.get(ren.from);
        if (existing) {
          state.columns.delete(ren.from);
          state.columns.set(ren.to, { ...existing, name: ren.to });
        }
      }
    }
  }
  return tables;
}

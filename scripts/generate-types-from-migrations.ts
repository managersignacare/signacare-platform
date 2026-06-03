#!/usr/bin/env tsx
/**
 * scripts/generate-types-from-migrations.ts
 *
 * Phase 0b.1 — gold-standard migration-driven type generator (CLI shim).
 *
 * Phase 0b.1b-i (2026-05-04): god-file split per L5 0b.1a advisory #2 — the
 * monolithic 715-LOC implementation was extracted into 4 focused modules
 * under `scripts/generate-types/`. This file is now a thin CLI shim that
 * imports the public API + invokes `main()` when run directly. Re-exports
 * exist so existing test imports (`import { ... } from '../generate-types-from-migrations'`)
 * continue to work without churn.
 *
 * Architecture (post-split):
 *   - scripts/generate-types/parser.ts    (findTableEvents + parseBuilderBody + types + ParseFailure)
 *   - scripts/generate-types/replayer.ts  (replayMigrations)
 *   - scripts/generate-types/emitter.ts   (emitRowInterface + emitDtoScaffold + emitResponseScaffold + type maps + zodExpressionForColumn)
 *   - scripts/generate-types/driver.ts    (loadMigrations + run + findPhantomTables + main)
 *
 * Re-export contract verified by the umbrella test suite — see fix-registry
 * row R-FIX-PHASE-0B.1B-I-GOD-FILE-SPLIT for the absorb-2 test count + the
 * commit body for the quoted command output.
 *
 * Phase 0b.1b-i absorbs L5 0b.1a advisory #1 (silent-skip-on-unparseable →
 * driver-decided warn-in-dry-run + process.exit(1)-in-full-run, per
 * operator-authorized gold-standard 2026-05-04) AND advisory #3 (decimal
 * precision preservation via Zod regex). See parser.ts + emitter.ts for
 * the absorb sites.
 *
 * Run: tsx scripts/generate-types-from-migrations.ts
 *      OR npm run generate:types-from-migrations
 *
 * Flags:
 *   --table <name>    Generate ONLY the named table
 *   --dry-run         Print what would be generated; don't write files; warn on parse failure
 *   --verbose         Show parsing diagnostics
 *
 * Exit codes:
 *   0 — success
 *   1 — parse failure (full-run mode) OR phantom table emission detected
 */

// Re-export public API so tests / consumers continue to import from this path.
export {
  type KnexColumnType,
  type ColumnDef,
  type ParseEvent,
  type ParseFailure,
  type ParsedBuilderBody,
  KNEX_COLUMN_TYPES,
  findTableEvents,
  extractCallbackBody,
  extractUpFunctionBody,
  parseTopLevelStringConsts,
  parseTopLevelStringArrayConsts,
  expandForOfLoops,
  parseBuilderBody,
} from './generate-types/parser';

export {
  type TableState,
  replayMigrations,
} from './generate-types/replayer';

export {
  TS_TYPE_MAP,
  ZOD_TYPE_MAP,
  zodExpressionForColumn,
  emitRowInterface,
  emitDtoScaffold,
  emitResponseScaffold,
} from './generate-types/emitter';

export {
  type RunOptions,
  type RunResult,
  loadMigrations,
  findPhantomTables,
  run,
  main,
} from './generate-types/driver';

import { main as driverMain } from './generate-types/driver';

if (require.main === module) {
  driverMain();
}

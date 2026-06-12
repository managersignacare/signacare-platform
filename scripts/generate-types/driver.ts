/**
 * scripts/generate-types/driver.ts
 *
 * Phase 0b.1b-i — extracted from `scripts/generate-types-from-migrations.ts`
 * per L5 0b.1a advisory #2 (god-file split). Re-export contract verified by
 * the umbrella test suite — see fix-registry row R-FIX-PHASE-0B.1B-I-GOD-FILE-SPLIT
 * for the absorb-2 test count + the commit body for the quoted command output.
 *
 * RESPONSIBILITY: orchestrate the parser → replayer → emitter pipeline +
 * filesystem I/O. Holds the phantom-table backstop (Phase 0b.1a cycle-2)
 * + CLI flag parsing + parse-failure decision (warn in --dry-run,
 * process.exit(1) in full-run — operator-authorized gold-standard 2026-05-04).
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { REPO_ROOT } from '../guards/lib/repoRoot';
import { findTableEvents, type ColumnDef, type ParseEvent, type ParseFailure } from './parser';
import { replayMigrations, type TableState } from './replayer';
import { emitRowInterface, emitDtoScaffold, emitResponseScaffold } from './emitter';

const MIGRATIONS_DIR = join(REPO_ROOT, 'apps/api/migrations');
const ROW_TYPES_DIR = join(REPO_ROOT, 'apps/api/src/db/types');
const SCAFFOLDS_DIR = join(REPO_ROOT, 'packages/shared/src/_scaffolds');
const SNAPSHOT_PATH = join(REPO_ROOT, 'apps/api/src/db/schema-snapshot.json');

interface SchemaSnapshot {
  readonly tables?: Record<string, string[]>;
  readonly columnMetadata?: Record<string, Record<string, SnapshotColumnMetadata>>;
}

interface SnapshotColumnMetadata {
  readonly dataType: string;
  readonly udtName: string;
  readonly isNullable: boolean;
  readonly hasDefault: boolean;
  readonly characterMaximumLength: number | null;
  readonly numericPrecision: number | null;
  readonly numericScale: number | null;
}

export function loadMigrations(
  filterTable?: string,
  onFailure?: (failure: ParseFailure) => void,
): Map<string, ParseEvent[]> {
  const eventsByMigration = new Map<string, ParseEvent[]>();
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.ts')).sort();
  for (const f of files) {
    const path = join(MIGRATIONS_DIR, f);
    const source = readFileSync(path, 'utf8');
    const events = findTableEvents(source, f, onFailure);
    const filtered = filterTable ? events.filter((e) => e.tableName === filterTable) : events;
    if (filtered.length > 0) eventsByMigration.set(f, filtered);
  }
  return eventsByMigration;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/**
 * Phase 0b.1a cycle-2 absorb of L3 CRITICAL finding: hard backstop for
 * phantom-table emission. Returns table names that the parser thinks exist
 * but the live schema (per `apps/api/src/db/schema-snapshot.json`) does not.
 * Empty list = clean.
 *
 * permanent: §12.3 snapshot-freshness CI guard (`check-snapshot-freshness.ts`)
 * structurally prevents a missing or stale snapshot from reaching CI. The
 * `return []` on missing snapshot defers to that guard rather than duplicating
 * the check here. Per L5 cycle-2 advisory + gold-standard-enforcer cycle-2.
 */
export function findPhantomTables(emittedNames: Iterable<string>): string[] {
  const snapshotPath = SNAPSHOT_PATH;
  if (!existsSync(snapshotPath)) return [];
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  const liveTables: Set<string> = new Set(Object.keys(snapshot.tables ?? {}));
  const phantoms: string[] = [];
  for (const name of emittedNames) {
    if (!liveTables.has(name)) phantoms.push(name);
  }
  return phantoms;
}

function snapshotKnexType(meta: SnapshotColumnMetadata): ColumnDef['knexType'] {
  const dataType = meta.dataType.toLowerCase();
  const udtName = meta.udtName.toLowerCase();
  if (dataType === 'uuid' || udtName === 'uuid') return 'uuid';
  if (dataType === 'character varying' || dataType === 'character' || udtName === 'varchar' || udtName === 'bpchar') return 'string';
  if (dataType === 'text' || udtName === 'text') return 'text';
  if (dataType === 'integer' || dataType === 'smallint' || udtName === 'int4' || udtName === 'int2') return 'integer';
  if (dataType === 'bigint' || udtName === 'int8') return 'bigInteger';
  if (dataType === 'boolean' || udtName === 'bool') return 'boolean';
  if (dataType === 'date' || udtName === 'date') return 'date';
  if (dataType.startsWith('timestamp') || udtName === 'timestamp' || udtName === 'timestamptz') return 'timestamp';
  if (dataType.startsWith('time') || udtName === 'time' || udtName === 'timetz') return 'time';
  if (dataType === 'jsonb' || udtName === 'jsonb') return 'jsonb';
  if (dataType === 'json' || udtName === 'json') return 'json';
  if (dataType === 'numeric' || dataType === 'decimal' || udtName === 'numeric') return 'decimal';
  return 'specificType';
}

function snapshotColumn(tableName: string, name: string, meta?: SnapshotColumnMetadata): ColumnDef {
  if (!meta) {
    throw new Error(
      `schema-snapshot column metadata missing for ${tableName}.${name}; run npm run db:snapshot --workspace=apps/api before generating types`,
    );
  }
  const knexType = snapshotKnexType(meta);
  return {
    name,
    knexType,
    nullable: meta.isNullable,
    hasDefault: meta.hasDefault,
    isPrimary: false,
    stringMaxLength: meta.characterMaximumLength ?? undefined,
    decimalPrecision: meta.numericPrecision ?? undefined,
    decimalScale: meta.numericScale ?? undefined,
    specificTypeRaw: knexType === 'specificType' ? (meta.udtName || meta.dataType) : undefined,
  };
}

function loadSnapshotTableStates(
  replayedTables: Map<string, TableState>,
  filterTable?: string,
): Map<string, TableState> {
  if (!existsSync(SNAPSHOT_PATH)) return replayedTables;

  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as SchemaSnapshot;
  const snapshotTables = snapshot.tables ?? {};
  const snapshotMetadata = snapshot.columnMetadata ?? {};
  const output = new Map<string, TableState>();

  for (const [name, columns] of Object.entries(snapshotTables)) {
    if (filterTable && name !== filterTable) continue;

    const replayed = replayedTables.get(name);
    const hasExistingGeneratedContract = existsSync(join(ROW_TYPES_DIR, `${name}.ts`));
    if (!replayed && !hasExistingGeneratedContract) continue;

    const reconciledColumns = new Map<string, ColumnDef>();
    for (const columnName of columns) {
      reconciledColumns.set(
        columnName,
        replayed?.columns.get(columnName) ?? snapshotColumn(name, columnName, snapshotMetadata[name]?.[columnName]),
      );
    }

    output.set(name, {
      name,
      columns: reconciledColumns,
      droppedFromMigrations: replayed?.droppedFromMigrations ?? [],
    });
  }

  return output;
}

export interface RunOptions {
  readonly filterTable?: string;
  readonly dryRun: boolean;
  readonly verbose: boolean;
  readonly skipSnapshotCrossCheck?: boolean;
}

export interface RunResult {
  tables: Map<string, TableState>;
  emitted: number;
  phantoms: string[];
  parseFailures: ParseFailure[];
}

export function run(opts: RunOptions): RunResult {
  const parseFailures: ParseFailure[] = [];
  const events = loadMigrations(opts.filterTable, (f) => parseFailures.push(f));
  const replayedTables = replayMigrations(events);
  const tables = opts.skipSnapshotCrossCheck
    ? replayedTables
    : loadSnapshotTableStates(replayedTables, opts.filterTable);

  if (opts.verbose) {
    // eslint-disable-next-line no-console
    console.log(`  migrations with events: ${events.size}`);
    // eslint-disable-next-line no-console
    console.log(`  tables found: ${tables.size}`);
    if (!opts.skipSnapshotCrossCheck && existsSync(SNAPSHOT_PATH)) {
      // eslint-disable-next-line no-console
      console.log(`  source: schema-snapshot reconciled with migration metadata`);
    }
    if (opts.filterTable) {
      // eslint-disable-next-line no-console
      console.log(`  filter: --table ${opts.filterTable}`);
    }
  }

  const emittedNames = Array.from(tables.entries()).filter(([_, s]) => s.columns.size > 0).map(([n]) => n);
  const phantoms = opts.skipSnapshotCrossCheck ? [] : findPhantomTables(emittedNames);

  if (opts.dryRun) return { tables, emitted: 0, phantoms, parseFailures };

  if (phantoms.length > 0 && !opts.filterTable) {
    return { tables, emitted: 0, phantoms, parseFailures };
  }

  ensureDir(ROW_TYPES_DIR);
  ensureDir(SCAFFOLDS_DIR);

  let emitted = 0;
  for (const [name, state] of tables) {
    if (state.columns.size === 0) continue;
    writeFileSync(join(ROW_TYPES_DIR, `${name}.ts`), emitRowInterface(state));
    writeFileSync(join(SCAFFOLDS_DIR, `${name}.dto.scaffold.ts`), emitDtoScaffold(state));
    writeFileSync(join(SCAFFOLDS_DIR, `${name}.response.scaffold.ts`), emitResponseScaffold(state));
    emitted++;
  }
  return { tables, emitted, phantoms, parseFailures };
}

export function main(): void {
  const args = process.argv.slice(2);
  const filterIdx = args.indexOf('--table');
  const filterTable = filterIdx >= 0 ? args[filterIdx + 1] : undefined;
  const dryRun = args.includes('--dry-run');
  const verbose = args.includes('--verbose');

  // eslint-disable-next-line no-console
  console.log('\n→ generate-types-from-migrations (Phase 0b.1)\n');
  const { tables, emitted, phantoms, parseFailures } = run({ filterTable, dryRun, verbose });

  // eslint-disable-next-line no-console
  console.log(`  tables parsed: ${tables.size}`);

  // L3 absorb-2 (operator-authorized 2026-05-04, gold-standard): warn in --dry-run,
  // hard-fail in full-run. Silent-skip would let the generator emit empty Row interfaces
  // for unparseable migrations — those compile cleanly but fail at runtime when the
  // consumer tries to insert/update. Hard-fail in full-run forces operator triage.
  if (parseFailures.length > 0) {
    if (dryRun) {
      for (const f of parseFailures) {
        // eslint-disable-next-line no-console
        console.warn(
          `[generate-types] WARN (--dry-run): ${f.migrationFile}: ` +
            `${f.kind}('${f.tableName}', ...) ${f.reason}. Event SKIPPED.`,
        );
      }
    } else {
      // eslint-disable-next-line no-console
      console.error(`\n✗ MIGRATION PARSE FAILURE — CI BLOCKING (full-run mode).`);
      // eslint-disable-next-line no-console
      console.error(`  ${parseFailures.length} migration event(s) could not be parsed:`);
      for (const f of parseFailures) {
        // eslint-disable-next-line no-console
        console.error(`    - ${f.migrationFile}: ${f.kind}('${f.tableName}') — ${f.reason}`);
      }
      // eslint-disable-next-line no-console
      console.error(`\n  Likely causes: unbalanced braces, malformed callback body, or unsupported syntax.`);
      // eslint-disable-next-line no-console
      console.error(`  To diagnose without exiting, re-run with --dry-run.`);
      process.exit(1);
    }
  }

  if (phantoms.length > 0 && !filterTable) {
    // eslint-disable-next-line no-console
    console.error(`\n✗ PHANTOM TABLE EMISSION DETECTED — CI BLOCKING.`);
    // eslint-disable-next-line no-console
    console.error(`  Generator parsed ${phantoms.length} table(s) NOT present in schema-snapshot.json:`);
    for (const p of phantoms.slice(0, 10)) {
      // eslint-disable-next-line no-console
      console.error(`    - ${p}`);
    }
    if (phantoms.length > 10) {
      // eslint-disable-next-line no-console
      console.error(`    ... and ${phantoms.length - 10} more`);
    }
    // eslint-disable-next-line no-console
    console.error(`\n  Likely causes:`);
    // eslint-disable-next-line no-console
    console.error(`    1. dropTable* event missing from parser`);
    // eslint-disable-next-line no-console
    console.error(`    2. Parser bug producing tables that don't actually exist post-replay`);
    // eslint-disable-next-line no-console
    console.error(`    3. Schema-snapshot stale (run: npm run db:snapshot --workspace=apps/api)`);
    process.exit(1);
  }

  if (dryRun) {
    // eslint-disable-next-line no-console
    console.log('  dry-run: no files emitted');
  } else {
    // eslint-disable-next-line no-console
    console.log(`  files emitted: ${emitted * 3} (${emitted} tables × 3 files each)`);
    // eslint-disable-next-line no-console
    console.log(`    Row interfaces: <repo>/apps/api/src/db/types`);
    // eslint-disable-next-line no-console
    console.log(`    DTO + Response scaffolds: <repo>/packages/shared/src/_scaffolds`);
  }

  if (filterTable) {
    const state = tables.get(filterTable);
    if (!state) {
      // eslint-disable-next-line no-console
      console.error(`\n✗ Table "${filterTable}" not found in any migration (or was dropped).`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`\n  ${filterTable}: ${state.columns.size} columns`);
    if (verbose) {
      for (const col of state.columns.values()) {
        const opt = col.nullable ? '?' : '!';
        // eslint-disable-next-line no-console
        console.log(`    ${opt} ${col.name}: ${col.knexType}${col.stringMaxLength ? `(${col.stringMaxLength})` : ''}`);
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log('\n✓ Generator run complete.');
}

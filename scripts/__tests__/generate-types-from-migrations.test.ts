/*
 * scripts/__tests__/generate-types-from-migrations.test.ts
 *
 * Phase 0b.1a — unit tests for the migration-driven type generator.
 *
 * Strategy: synthetic migration source → expected ParseEvent / ColumnDef
 * / TableState / emitted file content. No filesystem writes (generator
 * is import-safe; we test the pure functions: findTableEvents,
 * parseBuilderBody, replayMigrations, emitRowInterface, emitDtoScaffold,
 * emitResponseScaffold).
 *
 * Coverage strategy: exercise each of the 13 supported Knex column types,
 * each modifier shape (.notNullable() / .nullable() / .primary() /
 * .defaultTo() / .references().inTable()), and the 3 alterTable
 * operations (addColumn / dropColumn / renameColumn).
 */

import { describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  findTableEvents,
  parseBuilderBody,
  replayMigrations,
  emitRowInterface,
  emitDtoScaffold,
  emitResponseScaffold,
  zodExpressionForColumn,
  extractUpFunctionBody,
  parseTopLevelStringConsts,
  parseTopLevelStringArrayConsts,
  expandForOfLoops,
  findPhantomTables,
  type ParseEvent,
} from '../generate-types-from-migrations';

/**
 * Phase 0b.1b-ii-A: synthetic-source helper. The parser now scopes event
 * detection to the body of `export async function up(...)` (so a
 * `dropTableIfExists` in `down()` cannot silently remove a table created
 * by `up()`). Synthetic test fixtures wrap their migration-body string in
 * this canonical shape so they exercise the same code path the production
 * driver does.
 */
function wrapInUp(body: string): string {
  return `
    import { Knex } from 'knex';
    export async function up(knex: Knex): Promise<void> {
      ${body}
    }
    export async function down(knex: Knex): Promise<void> {
      // (rollback omitted — fixture is up()-only)
    }
  `;
}

describe('findTableEvents', () => {
  it('finds a single createTable event', () => {
    const source = wrapInUp(`
      await knex.schema.createTable('foo', (t) => {
        t.uuid('id').primary();
      });
    `);
    const events = findTableEvents(source, 'mig.ts');
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('createTable');
    expect(events[0].tableName).toBe('foo');
    expect(events[0].bodySource).toContain("t.uuid('id').primary()");
  });

  it('finds an alterTable event', () => {
    const source = wrapInUp(`
      await knex.schema.alterTable('bar', (t) => {
        t.text('notes');
      });
    `);
    const events = findTableEvents(source, 'mig.ts');
    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('alterTable');
    expect(events[0].tableName).toBe('bar');
  });

  it('finds multiple events in one migration', () => {
    const source = wrapInUp(`
      await knex.schema.createTable('a', (t) => { t.uuid('id'); });
      await knex.schema.createTable('b', (t) => { t.uuid('id'); });
      await knex.schema.alterTable('a', (t) => { t.text('notes'); });
    `);
    const events = findTableEvents(source, 'mig.ts');
    expect(events.length).toBe(3);
    expect(events.map((e) => e.tableName)).toEqual(['a', 'b', 'a']);
    expect(events.map((e) => e.kind)).toEqual(['createTable', 'createTable', 'alterTable']);
  });

  it('handles nested braces in callback body (e.g. defaultTo with object literal)', () => {
    const source = wrapInUp(`
      await knex.schema.createTable('foo', (t) => {
        t.timestamp('created_at', { useTz: true }).defaultTo(knex.fn.now());
        t.string('status').defaultTo('pending');
      });
    `);
    const events = findTableEvents(source, 'mig.ts');
    expect(events.length).toBe(1);
    expect(events[0].bodySource).toContain('useTz: true');
    expect(events[0].bodySource).toContain("defaultTo('pending')");
  });

  it('handles strings containing braces or quotes', () => {
    const source = wrapInUp(`
      await knex.schema.createTable('foo', (t) => {
        t.string('msg').defaultTo('hello { world }');
        t.string('quote').defaultTo("isn't");
      });
    `);
    const events = findTableEvents(source, 'mig.ts');
    expect(events.length).toBe(1);
    expect(events[0].bodySource).toContain("hello { world }");
  });

  it('skips line + block comments inside body', () => {
    const source = wrapInUp(`
      await knex.schema.createTable('foo', (t) => {
        // single-line { } comment with brace
        t.uuid('id');
        /* block { } comment */
        t.text('notes');
      });
    `);
    const events = findTableEvents(source, 'mig.ts');
    expect(events.length).toBe(1);
    expect(events[0].bodySource).toContain("t.uuid('id')");
    expect(events[0].bodySource).toContain("t.text('notes')");
  });
});

describe('parseBuilderBody — column type extraction', () => {
  it('extracts uuid column', () => {
    const result = parseBuilderBody(`t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));`);
    expect(result.columnAdds.length).toBe(1);
    expect(result.columnAdds[0].name).toBe('id');
    expect(result.columnAdds[0].knexType).toBe('uuid');
    expect(result.columnAdds[0].isPrimary).toBe(true);
    expect(result.columnAdds[0].nullable).toBe(false); // primary implies not-null
  });

  it('extracts string column with max length', () => {
    const result = parseBuilderBody(`t.string('name', 40).notNullable();`);
    expect(result.columnAdds[0].knexType).toBe('string');
    expect(result.columnAdds[0].stringMaxLength).toBe(40);
    expect(result.columnAdds[0].nullable).toBe(false);
  });

  it('extracts string column without max length (default varchar)', () => {
    const result = parseBuilderBody(`t.string('name');`);
    expect(result.columnAdds[0].stringMaxLength).toBeUndefined();
    expect(result.columnAdds[0].nullable).toBe(true); // Knex default
  });

  it('extracts text column', () => {
    const result = parseBuilderBody(`t.text('notes');`);
    expect(result.columnAdds[0].knexType).toBe('text');
    expect(result.columnAdds[0].nullable).toBe(true);
  });

  it('extracts integer column', () => {
    const result = parseBuilderBody(`t.integer('count').notNullable().defaultTo(0);`);
    expect(result.columnAdds[0].knexType).toBe('integer');
    expect(result.columnAdds[0].nullable).toBe(false);
    expect(result.columnAdds[0].hasDefault).toBe(true);
  });

  it('extracts boolean column', () => {
    const result = parseBuilderBody(`t.boolean('is_active').notNullable().defaultTo(true);`);
    expect(result.columnAdds[0].knexType).toBe('boolean');
    expect(result.columnAdds[0].nullable).toBe(false);
  });

  it('extracts date column', () => {
    const result = parseBuilderBody(`t.date('start_date').notNullable();`);
    expect(result.columnAdds[0].knexType).toBe('date');
  });

  it('extracts timestamp column with useTz', () => {
    const result = parseBuilderBody(`t.timestamp('created_at', { useTz: true }).notNullable();`);
    expect(result.columnAdds[0].knexType).toBe('timestamp');
    expect(result.columnAdds[0].nullable).toBe(false);
  });

  it('extracts jsonb column', () => {
    const result = parseBuilderBody(`t.jsonb('content');`);
    expect(result.columnAdds[0].knexType).toBe('jsonb');
  });

  it('extracts decimal column', () => {
    const result = parseBuilderBody(`t.decimal('amount', 10, 2);`);
    expect(result.columnAdds[0].knexType).toBe('decimal');
  });

  it('extracts foreign-key reference', () => {
    const result = parseBuilderBody(
      `t.uuid('clinic_id').notNullable().references('id').inTable('clinics').onDelete('CASCADE');`,
    );
    expect(result.columnAdds[0].references).toEqual({ table: 'clinics', column: 'id' });
  });

  it('skips index / unique / foreign builder calls', () => {
    const body = `
      t.uuid('id').primary();
      t.index(['clinic_id']);
      t.unique(['email']);
      t.foreign('staff_id').references('id').inTable('staff');
    `;
    const result = parseBuilderBody(body);
    expect(result.columnAdds.length).toBe(1);
    expect(result.columnAdds[0].name).toBe('id');
  });

  it('extracts dropColumn operations', () => {
    const result = parseBuilderBody(`
      t.dropColumn('old_field');
      t.dropColumn('also_old');
    `);
    expect(result.columnDrops).toEqual(['old_field', 'also_old']);
  });

  it('extracts renameColumn operations', () => {
    const result = parseBuilderBody(`t.renameColumn('old_name', 'new_name');`);
    expect(result.columnRenames).toEqual([{ from: 'old_name', to: 'new_name' }]);
  });
});

describe('replayMigrations', () => {
  function mkEvent(file: string, kind: 'createTable' | 'alterTable', table: string, body: string): ParseEvent {
    return { kind, tableName: table, bodySource: body, migrationFile: file };
  }

  it('builds initial table from createTable', () => {
    const events = new Map([
      ['001_init.ts', [mkEvent('001_init.ts', 'createTable', 'foo', `t.uuid('id').primary(); t.text('name');`)]],
    ]);
    const tables = replayMigrations(events);
    const foo = tables.get('foo')!;
    expect(foo.columns.size).toBe(2);
    expect(Array.from(foo.columns.keys())).toEqual(['id', 'name']);
  });

  it('applies alterTable column-add to existing table', () => {
    const events = new Map([
      ['001_init.ts', [mkEvent('001_init.ts', 'createTable', 'foo', `t.uuid('id').primary();`)]],
      ['002_alter.ts', [mkEvent('002_alter.ts', 'alterTable', 'foo', `t.text('name');`)]],
    ]);
    const tables = replayMigrations(events);
    const foo = tables.get('foo')!;
    expect(foo.columns.size).toBe(2);
  });

  it('applies dropColumn from alterTable', () => {
    const events = new Map([
      ['001_init.ts', [mkEvent('001_init.ts', 'createTable', 'foo', `t.uuid('id').primary(); t.text('old');`)]],
      ['002_drop.ts', [mkEvent('002_drop.ts', 'alterTable', 'foo', `t.dropColumn('old');`)]],
    ]);
    const tables = replayMigrations(events);
    const foo = tables.get('foo')!;
    expect(foo.columns.has('old')).toBe(false);
    expect(foo.columns.has('id')).toBe(true);
    expect(foo.droppedFromMigrations).toContain('002_drop.ts');
  });

  it('processes events in chronological filename order', () => {
    // Out-of-insertion-order map; sort by key should yield 001 then 002
    const events = new Map([
      ['002_alter.ts', [mkEvent('002_alter.ts', 'alterTable', 'foo', `t.text('added_second');`)]],
      ['001_init.ts', [mkEvent('001_init.ts', 'createTable', 'foo', `t.uuid('id'); t.text('first');`)]],
    ]);
    const tables = replayMigrations(events);
    const foo = tables.get('foo')!;
    // Insertion order should be id, first, added_second
    expect(Array.from(foo.columns.keys())).toEqual(['id', 'first', 'added_second']);
  });

  // Phase 0b.1a cycle-2 absorb of L3 CRITICAL finding: dropTable handling.
  it('cycle-2: dropTable removes the table from the post-replay map', () => {
    const events = new Map([
      ['001_init.ts', [mkEvent('001_init.ts', 'createTable', 'foo', `t.uuid('id'); t.text('field');`)]],
      ['002_drop.ts', [{ kind: 'dropTable' as const, tableName: 'foo', bodySource: '', migrationFile: '002_drop.ts' }]],
    ]);
    const tables = replayMigrations(events);
    expect(tables.has('foo')).toBe(false);
  });

  it('cycle-2: dropTableIfExists treated as dropTable kind by findTableEvents', () => {
    // Phase 0b.1b-ii-A: forward dropTable / dropTableIfExists in up() are
    // legitimate migration steps and must still be detected. The wrapInUp
    // helper places them in up() body — the bug-fix only blocks drops in down().
    const source = wrapInUp(`
      await knex.schema.createTable('foo', (t) => { t.uuid('id'); });
      await knex.schema.dropTable('foo');
      await knex.schema.dropTableIfExists('bar');
    `);
    const events = findTableEvents(source, 'mig.ts');
    const drops = events.filter(e => e.kind === 'dropTable');
    expect(drops.length).toBe(2);
    expect(drops.map(d => d.tableName).sort()).toEqual(['bar', 'foo']);
  });

  it('cycle-2: createTable → dropTable → createTable ends in second-create state', () => {
    const events = new Map([
      ['001_init.ts', [mkEvent('001_init.ts', 'createTable', 'foo', `t.uuid('id'); t.text('original');`)]],
      ['002_drop.ts', [{ kind: 'dropTable' as const, tableName: 'foo', bodySource: '', migrationFile: '002_drop.ts' }]],
      ['003_recreate.ts', [mkEvent('003_recreate.ts', 'createTable', 'foo', `t.uuid('id'); t.text('different');`)]],
    ]);
    const tables = replayMigrations(events);
    expect(tables.has('foo')).toBe(true);
    expect(Array.from(tables.get('foo')!.columns.keys())).toEqual(['id', 'different']);
    expect(tables.get('foo')!.columns.has('original')).toBe(false);
  });

  it('cycle-2: alterTable on dropped table is silently skipped (no resurrection)', () => {
    const events = new Map([
      ['001_init.ts', [mkEvent('001_init.ts', 'createTable', 'foo', `t.uuid('id');`)]],
      ['002_drop.ts', [{ kind: 'dropTable' as const, tableName: 'foo', bodySource: '', migrationFile: '002_drop.ts' }]],
      ['003_alter.ts', [mkEvent('003_alter.ts', 'alterTable', 'foo', `t.text('would_be_orphan');`)]],
    ]);
    const tables = replayMigrations(events);
    expect(tables.has('foo')).toBe(false); // drop wins; alter is no-op
  });
});

describe('Phase 0b.1b-i absorb of L5 0b.1a advisory #1 (silent-skip-on-unparseable)', () => {
  it('emits console.warn when up() body cannot be parsed (unbalanced braces propagate up)', () => {
    // Phase 0b.1b-ii-A refines this test class: an unclosed createTable
    // callback inside up() causes the whole up() to become unbalanced; the
    // parser's extractUpFunctionBody returns null and the file is treated as
    // a parse failure (same fail-loud class as advisory #1). Without up()
    // wrapping, the original test's bare malformed source would silently yield
    // events=[] which is the exact silent-skip class advisory #1 prohibits.
    const malformed = wrapInUp(`await knex.schema.createTable('foo', (t) => { t.uuid('id'); t.text('orphan'`);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events = findTableEvents(malformed, 'malformed_mig.ts');
      expect(events.length).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('malformed_mig.ts');
      expect(warnSpy.mock.calls[0][0]).toContain('up(');
      expect(warnSpy.mock.calls[0][0]).toContain('SKIPPED');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('emits console.warn when migration file lacks an export async function up(...) declaration', () => {
    // A migration file with no up() function is a programming error — fail loud.
    const noUp = `
      import { Knex } from 'knex';
      export async function down(knex: Knex): Promise<void> {
        await knex.schema.dropTableIfExists('foo');
      }
    `;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events = findTableEvents(noUp, 'no_up_mig.ts');
      expect(events.length).toBe(0);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('no_up_mig.ts');
      expect(warnSpy.mock.calls[0][0]).toContain('no balanced `export async function up');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does NOT warn when body parses cleanly', () => {
    const clean = wrapInUp(`await knex.schema.createTable('foo', (t) => { t.uuid('id'); });`);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events = findTableEvents(clean, 'mig.ts');
      expect(events.length).toBe(1);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  // L3 absorb-2 (operator-authorized 2026-05-04): findTableEvents accepts an
  // optional onFailure callback. When provided, parser routes the failure to
  // the callback INSTEAD of console.warn so the driver can hard-fail in
  // full-run mode (warn-only undermines source-of-truth claim).
  it('routes parse failures to onFailure callback when supplied (no console.warn)', () => {
    const malformed = wrapInUp(`await knex.schema.createTable('foo', (t) => { t.uuid('id'); t.text('orphan'`);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: Array<{ migrationFile: string; kind: string; tableName: string; reason: string }> = [];
    try {
      const events = findTableEvents(malformed, 'malformed_mig.ts', (f) => failures.push(f));
      expect(events.length).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled(); // callback path suppresses warn
      expect(failures).toHaveLength(1);
      expect(failures[0].migrationFile).toBe('malformed_mig.ts');
      // Phase 0b.1b-ii-A: the unbalanced inner callback poisons up()'s balance,
      // so this now surfaces as a file-level "no balanced up() body" failure
      // (not a callback-body failure). tableName is the synthetic '<file>' marker.
      expect(failures[0].kind).toBe('createTable');
      expect(failures[0].tableName).toBe('<file>');
      expect(failures[0].reason).toContain('no balanced `export async function up');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('Phase 0b.1b-i absorb of L5 0b.1a advisory #3 (decimal precision preservation)', () => {
  it('extracts (precision, scale) from t.decimal(col, N, M)', () => {
    const result = parseBuilderBody(`t.decimal('amount', 10, 2);`);
    expect(result.columnAdds[0].knexType).toBe('decimal');
    expect(result.columnAdds[0].decimalPrecision).toBe(10);
    expect(result.columnAdds[0].decimalScale).toBe(2);
  });

  it('extracts precision-only when scale is omitted (t.decimal(col, N))', () => {
    const result = parseBuilderBody(`t.decimal('amount', 8);`);
    expect(result.columnAdds[0].decimalPrecision).toBe(8);
    expect(result.columnAdds[0].decimalScale).toBeUndefined();
  });

  it('handles bare t.decimal(col) without precision', () => {
    const result = parseBuilderBody(`t.decimal('amount');`);
    expect(result.columnAdds[0].decimalPrecision).toBeUndefined();
    expect(result.columnAdds[0].decimalScale).toBeUndefined();
  });

  it('zodExpressionForColumn emits regex for decimal with precision + scale', () => {
    const expr = zodExpressionForColumn({
      name: 'amount',
      knexType: 'decimal',
      nullable: false,
      hasDefault: false,
      isPrimary: false,
      decimalPrecision: 10,
      decimalScale: 2,
    });
    // precision=10, scale=2 → integer digits = 8; pattern: -?\d{1,8}(\.\d{0,2})?
    expect(expr).toContain('z.string().regex');
    expect(expr).toContain('\\d{1,8}');
    expect(expr).toContain('\\d{0,2}');
  });

  it('zodExpressionForColumn emits regex for decimal with precision only (no scale)', () => {
    const expr = zodExpressionForColumn({
      name: 'count',
      knexType: 'decimal',
      nullable: false,
      hasDefault: false,
      isPrimary: false,
      decimalPrecision: 5,
    });
    // No scale → integer-only regex
    expect(expr).toContain('z.string().regex');
    expect(expr).toContain('\\d{1,5}');
    expect(expr).not.toContain('\\.');  // no decimal point in pattern
  });

  it('zodExpressionForColumn falls back to z.string() for bare decimal (no precision)', () => {
    const expr = zodExpressionForColumn({
      name: 'amount',
      knexType: 'decimal',
      nullable: false,
      hasDefault: false,
      isPrimary: false,
    });
    expect(expr).toBe('z.string()');
  });

  it('zodExpressionForColumn handles NUMERIC(4,5) (scale ≥ precision; fractional-only domain)', () => {
    // Postgres NUMERIC(P, S) where S ≥ P is valid (correlation coefficients,
    // normalized scores). Knex returns "0.12345" with leading zero — integer
    // part is always ≥1 digit. Math.max(0, P-S) would emit `\d{1,0}` (invalid
    // regex quantifier; crashes RegExp() at scaffold import). L3 absorb-2 fix:
    // Math.max(1, ...) clamps integer-digits to 1.
    const expr = zodExpressionForColumn({
      name: 'correlation',
      knexType: 'decimal',
      nullable: false,
      hasDefault: false,
      isPrimary: false,
      decimalPrecision: 4,
      decimalScale: 5,
    });
    expect(expr).toBe('z.string().regex(/^-?\\d{1,1}(\\.\\d{0,5})?$/)');
    // Smoke check: the emitted regex literal must be a constructible RegExp.
    const regexLiteral = expr.match(/regex\(\/(.+)\/\)/);
    expect(regexLiteral).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(() => new RegExp(regexLiteral![1])).not.toThrow();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const re = new RegExp(regexLiteral![1]);
    expect(re.test('0.12345')).toBe(true);
    expect(re.test('-0.12345')).toBe(true);
    expect(re.test('0.123456')).toBe(false); // exceeds scale
  });

  it('zodExpressionForColumn handles NUMERIC(3,3) (scale === precision)', () => {
    // Same class as NUMERIC(4,5) — Math.max(1,0)=1.
    const expr = zodExpressionForColumn({
      name: 'probability',
      knexType: 'decimal',
      nullable: false,
      hasDefault: false,
      isPrimary: false,
      decimalPrecision: 3,
      decimalScale: 3,
    });
    expect(expr).toBe('z.string().regex(/^-?\\d{1,1}(\\.\\d{0,3})?$/)');
    const regexLiteral = expr.match(/regex\(\/(.+)\/\)/);
    expect(regexLiteral).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const re = new RegExp(regexLiteral![1]);
    expect(re.test('0.999')).toBe(true);
    expect(re.test('0.000')).toBe(true);
    expect(re.test('1.000')).toBe(true); // 1 integer digit allowed
  });
});

describe('cycle-2: findPhantomTables (L3 CRITICAL backstop)', () => {
  it('returns empty list when all emitted tables exist in snapshot', () => {
    // schema-snapshot.json has clinic_thresholds (mechanically chosen fixture)
    expect(findPhantomTables(['clinic_thresholds'])).toEqual([]);
  });

  it('flags table that does not exist in snapshot', () => {
    expect(findPhantomTables(['definitely_not_a_real_table_xyzabc'])).toEqual(['definitely_not_a_real_table_xyzabc']);
  });

  it('flags only the missing tables when given a mixed list', () => {
    const phantoms = findPhantomTables(['clinic_thresholds', 'definitely_not_a_real_table_xyzabc', 'patients']);
    expect(phantoms).toEqual(['definitely_not_a_real_table_xyzabc']);
  });

  it('regression: staff_leave_periods (cycle-1 phantom example) is correctly flagged', () => {
    // staff_leave_periods was the original cycle-1 fixture target; it was
    // dropped in 20260423000004 and is NOT in schema-snapshot. The phantom
    // backstop must catch this exact case.
    expect(findPhantomTables(['staff_leave_periods'])).toEqual(['staff_leave_periods']);
  });
});

describe('emitRowInterface', () => {
  it('emits valid TS interface with required + optional fields', () => {
    const tables = replayMigrations(new Map([
      ['001.ts', [{
        kind: 'createTable', tableName: 'foo', migrationFile: '001.ts',
        bodySource: `t.uuid('id').primary(); t.text('name').notNullable(); t.text('notes');`,
      }]],
    ]));
    const out = emitRowInterface(tables.get('foo')!);
    expect(out).toContain('export interface FooRow {');
    expect(out).toContain('  id: string;');           // primary → required
    expect(out).toContain('  name: string;');         // notNullable → required
    expect(out).toContain('  notes?: string | null;'); // default nullable → optional + null
  });

  it('Phase 0b.2a: emits runtime <TABLE>_COLUMNS constant + <Table>Column union type', () => {
    const tables = replayMigrations(new Map([
      ['001.ts', [{
        kind: 'createTable', tableName: 'foo', migrationFile: '001.ts',
        bodySource: `t.uuid('id').primary(); t.text('name').notNullable(); t.text('notes');`,
      }]],
    ]));
    const out = emitRowInterface(tables.get('foo')!);
    // Runtime constant: SCREAMING_SNAKE_CASE matches table name + column literals in declaration order.
    expect(out).toContain('export const FOO_COLUMNS = [');
    expect(out).toContain("  'id',");
    expect(out).toContain("  'name',");
    expect(out).toContain("  'notes',");
    expect(out).toContain('] as const;');
    // Union type: PascalCase + Column suffix; derived from the constant.
    expect(out).toContain('export type FooColumn = typeof FOO_COLUMNS[number];');
  });

  it('Phase 0b.2a: handles multi-word snake_case table name in both runtime + type identifiers', () => {
    const tables = replayMigrations(new Map([
      ['001.ts', [{
        kind: 'createTable', tableName: 'patient_medications', migrationFile: '001.ts',
        bodySource: `t.uuid('id').primary(); t.uuid('patient_id').notNullable();`,
      }]],
    ]));
    const out = emitRowInterface(tables.get('patient_medications')!);
    expect(out).toContain('export const PATIENT_MEDICATIONS_COLUMNS = [');
    expect(out).toContain('export type PatientMedicationsColumn = typeof PATIENT_MEDICATIONS_COLUMNS[number];');
  });

  it('Phase 0b.2a: column literal order matches insertion order (= migration declaration order)', () => {
    // Insertion order is what the consumer expects when using the constant in a `.select(...COLUMNS)` call.
    const tables = replayMigrations(new Map([
      ['001.ts', [{
        kind: 'createTable', tableName: 'foo', migrationFile: '001.ts',
        bodySource: `t.uuid('id').primary(); t.string('name', 100); t.timestamp('created_at').defaultTo(knex.fn.now());`,
      }]],
    ]));
    const out = emitRowInterface(tables.get('foo')!);
    // Find positions of each literal in the constant; assert order id < name < created_at
    const idPos = out.indexOf("  'id',");
    const namePos = out.indexOf("  'name',");
    const createdPos = out.indexOf("  'created_at',");
    expect(idPos).toBeGreaterThan(0);
    expect(namePos).toBeGreaterThan(idPos);
    expect(createdPos).toBeGreaterThan(namePos);
  });
});

describe('emitDtoScaffold', () => {
  it('emits camelCase Zod schema with optional nullable fields', () => {
    const tables = replayMigrations(new Map([
      ['001.ts', [{
        kind: 'createTable', tableName: 'staff_leave_periods', migrationFile: '001.ts',
        bodySource: `t.uuid('id').primary(); t.string('leave_type', 40).notNullable(); t.text('notes');`,
      }]],
    ]));
    const out = emitDtoScaffold(tables.get('staff_leave_periods')!);
    expect(out).toContain('export const StaffLeavePeriodsDtoScaffoldSchema = z.object({');
    expect(out).toContain('  id: z.string().uuid(),');
    expect(out).toContain('  leaveType: z.string().max(40),');     // snake → camel + max length
    expect(out).toContain('  notes: z.string().nullable().optional(),'); // nullable
  });
});

describe('emitResponseScaffold', () => {
  it('emits camelCase Zod Response schema', () => {
    const tables = replayMigrations(new Map([
      ['001.ts', [{
        kind: 'createTable', tableName: 'foo', migrationFile: '001.ts',
        bodySource: `t.uuid('id').primary(); t.timestamp('created_at', { useTz: true }).notNullable();`,
      }]],
    ]));
    const out = emitResponseScaffold(tables.get('foo')!);
    expect(out).toContain('export const FooResponseScaffoldSchema = z.object({');
    expect(out).toContain('  createdAt: z.string().datetime(),'); // snake → camel; timestamp uses .datetime() per CLAUDE.md §5.1
  });
});

describe('integration — clinic_thresholds smoke test (cycle-2 mechanically-selected fixture)', () => {
  // Cycle-1 used staff_leave_periods (a PHANTOM TABLE — dropped in next migration).
  // Cycle-2 mechanically selects clinic_thresholds: in-snapshot, never-dropped,
  // touched by 2 migrations (createTable in baseline + alterTable adding unique
  // constraint in BUG-592 follow-up). Smoke test feeds BOTH migrations to
  // exercise create + alter replay AND asserts post-replay state matches the
  // live schema-snapshot.
  it('parses both migrations + final state matches schema-snapshot', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const repoRoot = path.resolve(__dirname, '..', '..');

    const baselinePath = path.join(repoRoot, 'apps/api/migrations/20260701000000_baseline.ts');
    const alterPath = path.join(repoRoot, 'apps/api/migrations/20260701000053_bug_592_fu_clinic_thresholds_unique.ts');

    const baselineSrc = fs.readFileSync(baselinePath, 'utf8');
    const alterSrc = fs.readFileSync(alterPath, 'utf8');

    const baselineEvents = findTableEvents(baselineSrc, '20260701000000_baseline.ts')
      .filter((e) => e.tableName === 'clinic_thresholds');
    const alterEvents = findTableEvents(alterSrc, '20260701000053_bug_592_fu_clinic_thresholds_unique.ts')
      .filter((e) => e.tableName === 'clinic_thresholds');

    const eventsByMig = new Map([
      ['20260701000000_baseline.ts', baselineEvents],
      ['20260701000053_bug_592_fu_clinic_thresholds_unique.ts', alterEvents],
    ]);
    const tables = replayMigrations(eventsByMig);

    expect(tables.has('clinic_thresholds')).toBe(true);
    const ct = tables.get('clinic_thresholds')!;

    // Cross-check against schema-snapshot.json (live truth)
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'apps/api/src/db/schema-snapshot.json'), 'utf8'),
    );
    const liveColumns = new Set<string>(snapshot.tables.clinic_thresholds);
    const generatedColumns = new Set(ct.columns.keys());
    expect(generatedColumns).toEqual(liveColumns);

    // Specific column shape assertions
    expect(ct.columns.get('id')!.isPrimary).toBe(true);
    expect(ct.columns.get('id')!.knexType).toBe('uuid');
    expect(ct.columns.get('clinic_id')!.references).toEqual({ table: 'clinics', column: 'id' });
    expect(ct.columns.get('clinic_id')!.nullable).toBe(true); // .nullable() in baseline
    expect(ct.columns.get('threshold_key')!.stringMaxLength).toBe(100);
    expect(ct.columns.get('threshold_value')!.knexType).toBe('decimal');
    expect(ct.columns.get('created_at')!.knexType).toBe('timestamp');
    expect(ct.columns.get('created_at')!.nullable).toBe(false); // .notNullable() in baseline

    // Phantom-table backstop: verify clinic_thresholds is recognized by findPhantomTables
    expect(findPhantomTables(['clinic_thresholds'])).toEqual([]);
  });

  it('regression: feeding ONLY the baseline migration produces the same shape (alter only adds unique constraint, no columns)', async () => {
    // Documents that the alter migration adds NO columns — only a unique
    // constraint, which the parser correctly skips. So the baseline alone
    // produces the final state. This is the WHY behind picking
    // clinic_thresholds: small + 2 migrations + alter is a constraint-only
    // change that exercises alter-replay without column drift.
    const fs = await import('fs');
    const path = await import('path');
    const repoRoot = path.resolve(__dirname, '..', '..');
    const baselineSrc = fs.readFileSync(
      path.join(repoRoot, 'apps/api/migrations/20260701000000_baseline.ts'),
      'utf8',
    );
    const events = findTableEvents(baselineSrc, '20260701000000_baseline.ts')
      .filter((e) => e.tableName === 'clinic_thresholds');
    const tables = replayMigrations(new Map([['20260701000000_baseline.ts', events]]));
    expect(tables.has('clinic_thresholds')).toBe(true);
    expect(tables.get('clinic_thresholds')!.columns.size).toBe(7);
  });
});

describe('Phase 0b.1b-ii-A: extractUpFunctionBody + up()-only event scoping', () => {
  // The pre-fix shape: parser walked the entire migration source, so
  // `dropTableIfExists` calls in `down()` (rollback) were treated as in-band
  // events and silently removed tables created by `up()`. Pre-fix this
  // affected 34 real tables (scribe_*, letters/letter_*, capacity_assessments,
  // clinic_settings, llm_prompts_outputs, model_*, etc.). The fix scopes
  // `findTableEvents` to the `up()` body only.

  const migrationWithUpAndDown = `
    import { Knex } from 'knex';

    export async function up(knex: Knex): Promise<void> {
      await knex.schema.createTable('canary_table', (t) => {
        t.uuid('id').primary();
        t.text('label').notNullable();
      });
    }

    export async function down(knex: Knex): Promise<void> {
      await knex.schema.dropTableIfExists('canary_table');
    }
  `;

  it('extractUpFunctionBody returns the up() body (not down())', () => {
    const body = extractUpFunctionBody(migrationWithUpAndDown);
    expect(body).not.toBeNull();
    expect(body).toContain("createTable('canary_table'");
    expect(body).not.toContain('dropTableIfExists');
  });

  it('extractUpFunctionBody returns null for source without an up() function', () => {
    const noUp = `
      import { Knex } from 'knex';
      export async function down(knex: Knex): Promise<void> {
        await knex.schema.dropTableIfExists('canary_table');
      }
    `;
    expect(extractUpFunctionBody(noUp)).toBeNull();
  });

  it('regression: createTable in up() + dropTableIfExists in down() preserves the table', () => {
    // This is THE bug fix. Pre-fix: parser saw both events as in-band, the
    // dropTable wins (later in source), table is removed. Post-fix: parser
    // only walks up(), so canary_table survives.
    const events = findTableEvents(migrationWithUpAndDown, 'canary_mig.ts');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('createTable');
    expect(events[0].tableName).toBe('canary_table');

    const tables = replayMigrations(new Map([['canary_mig.ts', events]]));
    expect(tables.has('canary_table')).toBe(true);
    expect(tables.get('canary_table')!.columns.size).toBe(2); // id + label
  });

  it('legitimate dropTable in up() (forward migration step) still drops the table', () => {
    const dropForward = `
      export async function up(knex: Knex): Promise<void> {
        await knex.schema.dropTableIfExists('legacy_table');
      }
      export async function down(knex: Knex): Promise<void> {
        // (rollback recreates it elsewhere)
      }
    `;
    const events = findTableEvents(dropForward, 'drop_forward_mig.ts');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('dropTable');
    expect(events[0].tableName).toBe('legacy_table');
  });

  it('regression-fixture: psychology_session_notes is now emitted (was silently dropped pre-fix)', () => {
    // Live-fixture mirror of the bug-finding evidence. Reads the actual
    // migration file for psychology_session_notes (one of the 34 affected
    // tables) + asserts the table survives replay.
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../apps/api/migrations/20260701000017_psychology_session_notes.ts'),
      'utf8',
    );
    const events = findTableEvents(src, '20260701000017_psychology_session_notes.ts');
    const tables = replayMigrations(new Map([['20260701000017_psychology_session_notes.ts', events]]));
    expect(tables.has('psychology_session_notes')).toBe(true);
    expect(tables.get('psychology_session_notes')!.columns.size).toBeGreaterThan(0);
  });
});

describe('Phase 0b.1b-ii-A: const-bound table names (operator-authorized 2026-05-04)', () => {
  // Operator-scoped: only plain string-literal const bindings, same-file
  // resolution, fail loud if identifier is not bound to a plain string.

  it('parseTopLevelStringConsts extracts plain `const NAME = \'string\';` bindings', () => {
    const src = `
      import { Knex } from 'knex';
      const TABLE = 'foo';
      const OTHER_TABLE = "bar";
      const STILL_ANOTHER = \`baz\`;
      export const PUBLIC_TABLE = 'qux';
    `;
    const bindings = parseTopLevelStringConsts(src);
    expect(bindings.get('TABLE')).toBe('foo');
    expect(bindings.get('OTHER_TABLE')).toBe('bar');
    expect(bindings.get('STILL_ANOTHER')).toBe('baz');
    expect(bindings.get('PUBLIC_TABLE')).toBe('qux');
  });

  it('parseTopLevelStringConsts ignores non-string-literal RHS (call expressions, identifiers, etc.)', () => {
    const src = `
      const TABLE = makeName('foo');
      const ALIAS = OTHER_CONST;
      const LET_BINDING = 'foo';  // valid (let counted? no — only const)
      let SHOULD_SKIP = 'should-skip';
    `;
    const bindings = parseTopLevelStringConsts(src);
    expect(bindings.has('TABLE')).toBe(false);
    expect(bindings.has('ALIAS')).toBe(false);
    expect(bindings.has('SHOULD_SKIP')).toBe(false);
    expect(bindings.get('LET_BINDING')).toBe('foo');
  });

  it('findTableEvents resolves createTable(IDENTIFIER, ...) using top-level const bindings', () => {
    const src = `
      import { Knex } from 'knex';
      const TABLE = 'llm_prompts_outputs';
      export async function up(knex: Knex): Promise<void> {
        await knex.schema.createTable(TABLE, (t) => {
          t.uuid('id').primary();
          t.text('prompt').notNullable();
        });
      }
      export async function down(knex: Knex): Promise<void> {
        await knex.schema.dropTableIfExists(TABLE);
      }
    `;
    const events = findTableEvents(src, 'mig.ts');
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('createTable');
    expect(events[0].tableName).toBe('llm_prompts_outputs');
    // dropTableIfExists in down() is not detected: parser is scoped to up() body only.
  });

  it('findTableEvents fails loud (warn) when identifier is not bound to a plain string literal', () => {
    const src = `
      const COMPUTED = makeTableName('x');
      export async function up(knex: Knex): Promise<void> {
        await knex.schema.createTable(COMPUTED, (t) => {
          t.uuid('id');
        });
      }
    `;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events = findTableEvents(src, 'mig.ts');
      expect(events).toHaveLength(0); // event SKIPPED
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('mig.ts');
      expect(warnSpy.mock.calls[0][0]).toContain('COMPUTED');
      expect(warnSpy.mock.calls[0][0]).toContain('not bound to a plain string literal');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('findTableEvents routes identifier-binding-failure to onFailure callback when supplied', () => {
    const src = `
      const COMPUTED = someFunc();
      export async function up(knex: Knex): Promise<void> {
        await knex.schema.createTable(COMPUTED, (t) => {
          t.uuid('id');
        });
      }
    `;
    const failures: Array<{ migrationFile: string; kind: string; tableName: string; reason: string }> = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const events = findTableEvents(src, 'mig.ts', (f) => failures.push(f));
      expect(events).toHaveLength(0);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(failures).toHaveLength(1);
      expect(failures[0].kind).toBe('createTable');
      expect(failures[0].tableName).toBe('<COMPUTED>');
      expect(failures[0].reason).toContain('not bound to a plain string literal');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('regression-fixture: llm_prompts_outputs is now emitted (was unresolved pre-fix)', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../apps/api/migrations/20260701000036_llm_prompts_outputs.ts'),
      'utf8',
    );
    const events = findTableEvents(src, '20260701000036_llm_prompts_outputs.ts');
    const tables = replayMigrations(new Map([['20260701000036_llm_prompts_outputs.ts', events]]));
    expect(tables.has('llm_prompts_outputs')).toBe(true);
    expect(tables.get('llm_prompts_outputs')!.columns.size).toBeGreaterThan(0);
  });
});

describe('Phase 0b.1b-ii-A: for-of-of-const-string-array expansion (BUG-371 batch-alter pattern)', () => {
  // Operator-authorized 2026-05-04: extends the const-binding fix to cover
  // batch-alter migrations like BUG-371 where multiple tables get a new
  // column via a for-of loop over a top-level string array.

  it('parseTopLevelStringArrayConsts extracts plain `const X = [\'a\', \'b\'] as const` arrays', () => {
    const src = `
      const TABLES = ['prescriptions', 'patient_medications', 'episodes'] as const;
      const NO_AS_CONST = ['foo', 'bar'];
      const SINGLE_QUOTE = ['a'];
    `;
    const bindings = parseTopLevelStringArrayConsts(src);
    expect(bindings.get('TABLES')).toEqual(['prescriptions', 'patient_medications', 'episodes']);
    expect(bindings.get('NO_AS_CONST')).toEqual(['foo', 'bar']);
    expect(bindings.get('SINGLE_QUOTE')).toEqual(['a']);
  });

  it('parseTopLevelStringArrayConsts ignores arrays containing non-string-literal elements', () => {
    const src = `
      const MIXED = ['foo', someExpr, 'bar'];
      const COMPUTED = [makeStr('x'), 'foo'];
    `;
    const bindings = parseTopLevelStringArrayConsts(src);
    expect(bindings.has('MIXED')).toBe(false);
    expect(bindings.has('COMPUTED')).toBe(false);
  });

  it('expandForOfLoops substitutes loop variable with each array element (one synthetic body per iteration)', () => {
    const upBody = `
      for (const table of TABLES) {
        await knex.schema.alterTable(table, (t) => {
          t.integer('lock_version').notNullable().defaultTo(1);
        });
      }
    `;
    const arrayBindings = new Map([['TABLES', ['prescriptions', 'patient_medications', 'episodes']]]);
    const expanded = expandForOfLoops(upBody, arrayBindings);
    expect(expanded).toContain("alterTable('prescriptions'");
    expect(expanded).toContain("alterTable('patient_medications'");
    expect(expanded).toContain("alterTable('episodes'");
    expect(expanded).not.toContain('for (const table of TABLES)');
  });

  it('expandForOfLoops leaves for-of loops over unrecognized arrays untouched (fail-loud propagates)', () => {
    const upBody = `
      for (const table of UNKNOWN_ARRAY) {
        await knex.schema.alterTable(table, (t) => {});
      }
    `;
    const expanded = expandForOfLoops(upBody, new Map());
    expect(expanded).toContain('for (const table of UNKNOWN_ARRAY)');
  });

  it('findTableEvents expands for-of-loop into N alterTable events', () => {
    const src = `
      const TABLES = ['prescriptions', 'patient_medications', 'episodes'] as const;
      export async function up(knex: Knex): Promise<void> {
        for (const table of TABLES) {
          await knex.schema.alterTable(table, (t) => {
            t.integer('lock_version').notNullable().defaultTo(1);
          });
        }
      }
      export async function down(knex: Knex): Promise<void> {
        for (const table of TABLES) {
          await knex.schema.alterTable(table, (t) => {
            t.dropColumn('lock_version');
          });
        }
      }
    `;
    const events = findTableEvents(src, 'mig.ts');
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.kind)).toEqual(['alterTable', 'alterTable', 'alterTable']);
    expect(events.map((e) => e.tableName).sort()).toEqual(['episodes', 'patient_medications', 'prescriptions']);
    // Each event's bodySource should contain the lock_version column add.
    for (const ev of events) {
      expect(ev.bodySource).toContain("t.integer('lock_version')");
    }
  });

  it('regression-fixture: BUG-371 lock_version migration replays into 3 alter events on the right tables', () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, '../../apps/api/migrations/20260701000037_bug_371_opt_locking_columns.ts'),
      'utf8',
    );
    const events = findTableEvents(src, '20260701000037_bug_371_opt_locking_columns.ts');
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.kind === 'alterTable')).toBe(true);
    expect(events.map((e) => e.tableName).sort()).toEqual(['episodes', 'patient_medications', 'prescriptions']);
    for (const ev of events) {
      expect(ev.bodySource).toContain("t.integer('lock_version')");
    }
  });

  it('uses schema-snapshot metadata instead of unknown for snapshot-only scalar columns', () => {
    const clinicsType = fs.readFileSync(
      path.resolve(__dirname, '../../apps/api/src/db/types/clinics.ts'),
      'utf8',
    );

    expect(clinicsType).toContain('nominated_admin_staff_id?: string | null;');
    expect(clinicsType).toContain('data_retention_years: number;');
    expect(clinicsType).toContain('retention_purge_enabled: boolean;');
    expect(clinicsType).not.toContain('nominated_admin_staff_id?: unknown | null;');
    expect(clinicsType).not.toContain('data_retention_years?: unknown | null;');
  });
});

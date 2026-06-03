export type MigrationTableCallKind = 'createTable' | 'createTableIfNotExists' | 'alterTable';

export interface MigrationTableBlock {
  kind: MigrationTableCallKind;
  tableSpec: string;
  openerIndex: number;
  bodyStart: number;
  bodyEnd: number;
  body: string;
}

export interface FindMigrationTableBlocksOptions {
  includeAlterTable?: boolean;
}

/**
 * File-level `@migration-squashed-baseline` directive check shared by
 * migration-focused guards.
 */
export function isMigrationSquashedBaseline(source: string): boolean {
  return /@migration-squashed-baseline\b/.test(source);
}

/**
 * Extract Knex create/alterTable callback bodies from a migration source.
 *
 * Expected call shape:
 *   createTable('<table>', (t) => { ... })
 *   createTableIfNotExists('<table>', (t) => { ... })
 *   alterTable('<table>', (t) => { ... })
 *
 * The parser is intentionally narrow and returns only blocks whose callback
 * body braces can be balanced.
 */
export function findMigrationTableBlocks(
  source: string,
  opts: FindMigrationTableBlocksOptions = {},
): MigrationTableBlock[] {
  const includeAlterTable = opts.includeAlterTable ?? true;
  const out: MigrationTableBlock[] = [];
  const opener =
    /(createTableIfNotExists|createTable|alterTable)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*\(\s*[\w$]+\s*\)\s*=>\s*\{/g;

  let m: RegExpExecArray | null;
  while ((m = opener.exec(source)) !== null) {
    const kind = m[1] as MigrationTableCallKind;
    if (!includeAlterTable && kind === 'alterTable') continue;

    const tableSpec = m[2];
    const openerIndex = m.index;
    const bodyStart = openerIndex + m[0].length;

    let braceDepth = 1;
    let i = bodyStart;
    while (i < source.length && braceDepth > 0) {
      const c = source[i];
      if (c === '{') braceDepth++;
      else if (c === '}') braceDepth--;
      i++;
    }
    if (braceDepth !== 0) continue;

    const bodyEnd = i - 1;
    out.push({
      kind,
      tableSpec,
      openerIndex,
      bodyStart,
      bodyEnd,
      body: source.slice(bodyStart, bodyEnd),
    });
  }

  return out;
}

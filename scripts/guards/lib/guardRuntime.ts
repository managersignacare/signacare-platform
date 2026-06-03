import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve } from 'path';

export interface WalkTsOptions {
  excludeDirs?: string[];
}

export interface WalkSourceOptions {
  excludeDirs?: string[];
  extensions?: string[];
  excludeSuffixes?: string[];
}

const DEFAULT_EXCLUDE_DIRS = ['node_modules', 'dist', '__tests__'];
const DEFAULT_TS_EXTENSIONS = ['.ts'];
const DEFAULT_TS_EXCLUDE_SUFFIXES = ['.d.ts', '.test.ts', '.spec.ts'];

/**
 * Shared TypeScript file walker for guard scripts.
 *
 * Includes:
 * - *.ts
 *
 * Excludes:
 * - *.d.ts
 * - *.test.ts
 * - *.spec.ts
 * - configured directory names
 */
export function walkTsFiles(dir: string, out: string[] = [], opts: WalkTsOptions = {}): string[] {
  return walkSourceFiles(dir, out, {
    excludeDirs: opts.excludeDirs,
    extensions: DEFAULT_TS_EXTENSIONS,
    excludeSuffixes: DEFAULT_TS_EXCLUDE_SUFFIXES,
  });
}

export function walkSourceFiles(dir: string, out: string[] = [], opts: WalkSourceOptions = {}): string[] {
  const excludeDirs = new Set(opts.excludeDirs ?? DEFAULT_EXCLUDE_DIRS);
  const extensions = opts.extensions ?? DEFAULT_TS_EXTENSIONS;
  const excludeSuffixes = opts.excludeSuffixes ?? DEFAULT_TS_EXCLUDE_SUFFIXES;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }

  for (const entry of entries) {
    const full = resolve(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      if (excludeDirs.has(entry)) continue;
      walkSourceFiles(full, out, opts);
      continue;
    }

    if (!extensions.some((ext) => entry.endsWith(ext))) continue;
    if (excludeSuffixes.some((suffix) => entry.endsWith(suffix))) continue;
    out.push(full);
  }

  return out;
}

/**
 * Non-recursive top-level TypeScript file listing.
 */
export function listTopLevelTsFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }

  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.ts')) continue;
    const full = resolve(dir, entry);
    const stats = statSync(full);
    if (!stats.isFile()) continue;
    out.push(full);
  }
  return out.sort();
}

export function buildLineOffsets(source: string): number[] {
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') offsets.push(i + 1);
  }
  offsets.push(source.length + 1);
  return offsets;
}

export function lineNoOfIndex(lineOffsets: number[], idx: number): number {
  let lo = 0;
  let hi = lineOffsets.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx >= lineOffsets[mid] && idx < lineOffsets[mid + 1]) return mid + 1;
    if (idx < lineOffsets[mid]) hi = mid - 1;
    else lo = mid + 1;
  }
  return 1;
}

/**
 * Checks only the line immediately above the target line.
 */
export function hasInlineExemptionOnPreviousLine(
  source: string,
  lineNo: number,
  lineOffsets: number[],
  exemptionPattern: RegExp,
): boolean {
  if (lineNo < 2) return false;
  const prevLineStart = lineOffsets[lineNo - 2];
  const prevLineEnd = lineOffsets[lineNo - 1];
  const prevLine = source.slice(prevLineStart, prevLineEnd);
  return exemptionPattern.test(prevLine);
}

/**
 * Guard family discipline: many scanners require schema snapshot readability
 * even when the guard's logic is source-only. This keeps the exit-code
 * contract (0/1/2) consistent across siblings.
 */
export function hasUsableSchemaSnapshot(snapshotPath: string): boolean {
  return readSchemaTables(snapshotPath) !== null;
}

/**
 * Parses schema-snapshot.json and returns tables map when structurally valid.
 */
export function readSchemaTables(snapshotPath: string): Record<string, string[]> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const tables = (parsed as { tables?: unknown }).tables;
  if (!tables || typeof tables !== 'object' || Object.keys(tables as object).length === 0) {
    return null;
  }
  return tables as Record<string, string[]>;
}

/**
 * Strip comments while preserving source layout for stable line-number mapping.
 *
 * String literals are kept intact so downstream scanners that rely on
 * token/identifier shapes inside strings continue to behave as before.
 */
export function stripCommentsPreservingLayout(source: string): string {
  const out: string[] = new Array(source.length);
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inString: string | null = null;
  let escaped = false;

  while (i < source.length) {
    const c = source[i];
    const c2 = source[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out[i] = '\n';
      } else {
        out[i] = ' ';
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (c === '*' && c2 === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        inBlock = false;
        i += 2;
        continue;
      }
      out[i] = c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    if (inString) {
      out[i] = c;
      if (escaped) {
        escaped = false;
      } else if (c === '\\') {
        escaped = true;
      } else if (c === inString) {
        inString = null;
      }
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out[i] = c;
      i++;
      continue;
    }
    if (c === '/' && c2 === '/') {
      inLine = true;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (c === '/' && c2 === '*') {
      inBlock = true;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    out[i] = c;
    i++;
  }

  return out.join('');
}

/**
 * Strip comments and string contents while preserving source layout.
 *
 * String delimiters are retained, but string bodies are blanked to reduce
 * false positives when guards regex-scan for code-like tokens.
 */
export function stripCommentsAndStringsPreservingLayout(source: string): string {
  const out: string[] = new Array(source.length);
  let i = 0;
  let inLine = false;
  let inBlock = false;
  let inString: string | null = null;
  let escaped = false;

  while (i < source.length) {
    const c = source[i];
    const c2 = source[i + 1];
    if (inLine) {
      if (c === '\n') {
        inLine = false;
        out[i] = '\n';
      } else {
        out[i] = ' ';
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (c === '*' && c2 === '/') {
        out[i] = ' ';
        out[i + 1] = ' ';
        inBlock = false;
        i += 2;
        continue;
      }
      out[i] = c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
        out[i] = c === '\n' ? '\n' : ' ';
        i++;
        continue;
      }
      if (c === '\\') {
        escaped = true;
        out[i] = ' ';
        i++;
        continue;
      }
      if (c === inString) {
        inString = null;
        out[i] = c;
        i++;
        continue;
      }
      out[i] = c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      inString = c;
      out[i] = c;
      i++;
      continue;
    }
    if (c === '/' && c2 === '/') {
      inLine = true;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    if (c === '/' && c2 === '*') {
      inBlock = true;
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      continue;
    }
    out[i] = c;
    i++;
  }

  return out.join('');
}

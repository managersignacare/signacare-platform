import { readFileSync, readdirSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

type GuardInfo = {
  file: string;
  relFile: string;
  source: string;
  normalized: string;
  tokens: Set<string>;
  tags: string[];
};

type SimilarPair = {
  a: GuardInfo;
  b: GuardInfo;
  score: number;
};

const ROOT = resolve(__dirname, '..', '..');
const GUARDS_DIR = resolve(ROOT, 'scripts/guards');
const SIMILARITY_THRESHOLD = 0.58;

function listGuardFiles(): string[] {
  return readdirSync(GUARDS_DIR)
    .filter((name) => name.startsWith('check-') && extname(name) === '.ts')
    .map((name) => join(GUARDS_DIR, name))
    .sort();
}

function normalizeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/gm, ' ')
    .replace(/(["'`])(?:(?=(\\?))\2.)*?\1/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function tokenize(normalized: string): Set<string> {
  return new Set(normalized.split(/[^a-z0-9_]+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) {
      intersection += 1;
    }
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function detectTags(source: string): string[] {
  const tags: string[] = [];
  if (/lib\/allowlist-fingerprint/.test(source)) tags.push('fingerprint-allowlist-core');
  if (/DEFAULT_ALLOWLIST_PATH/.test(source)) tags.push('default-allowlist-path');
  if (/readdirSync\(/.test(source) && /statSync\(/.test(source)) tags.push('custom-recursive-scan');
  if (/typescript/.test(source) || /from 'typescript'/.test(source) || /from "typescript"/.test(source)) tags.push('ts-ast-scan');
  if (/process\.exitCode/.test(source)) tags.push('exitcode-main');
  if (/readFileSync\(/.test(source) && /allowlist/i.test(source)) tags.push('allowlist-loader');
  return tags;
}

function buildGuardInfo(file: string): GuardInfo {
  const source = readFileSync(file, 'utf8');
  const normalized = normalizeSource(source);
  return {
    file,
    relFile: relative(ROOT, file),
    source,
    normalized,
    tokens: tokenize(normalized),
    tags: detectTags(source),
  };
}

function buildSimilarPairs(guards: GuardInfo[]): SimilarPair[] {
  const pairs: SimilarPair[] = [];
  for (let i = 0; i < guards.length; i += 1) {
    for (let j = i + 1; j < guards.length; j += 1) {
      const a = guards[i];
      const b = guards[j];
      const score = jaccard(a.tokens, b.tokens);
      if (score >= SIMILARITY_THRESHOLD) {
        pairs.push({ a, b, score });
      }
    }
  }
  pairs.sort((lhs, rhs) => rhs.score - lhs.score);
  return pairs;
}

function buildSimilarityComponents(guards: GuardInfo[], pairs: SimilarPair[]): string[][] {
  const parent = new Map<string, string>();
  for (const guard of guards) parent.set(guard.file, guard.file);

  const find = (x: string): string => {
    const p = parent.get(x);
    if (!p || p === x) return x;
    const root = find(p);
    parent.set(x, root);
    return root;
  };

  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const pair of pairs) {
    union(pair.a.file, pair.b.file);
  }

  const groups = new Map<string, string[]>();
  for (const guard of guards) {
    const root = find(guard.file);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(guard.relFile);
  }

  return Array.from(groups.values())
    .filter((files) => files.length > 1)
    .sort((a, b) => b.length - a.length);
}

function countTags(guards: GuardInfo[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const guard of guards) {
    for (const tag of guard.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

function run(): number {
  const guardFiles = listGuardFiles();
  const guards = guardFiles.map(buildGuardInfo);
  const pairs = buildSimilarPairs(guards);
  const components = buildSimilarityComponents(guards, pairs);
  const tags = countTags(guards);

  console.log('\n=== check-guard-overlap ===\n');
  console.log(`  guards scanned:             ${guards.length}`);
  console.log(`  similarity threshold:       ${SIMILARITY_THRESHOLD.toFixed(2)}`);
  console.log(`  high-similarity pairs:      ${pairs.length}`);
  console.log(`  multi-file similarity sets: ${components.length}`);

  if (tags.length > 0) {
    console.log('\n  pattern tags:');
    for (const entry of tags) {
      console.log(`    - ${entry.tag}: ${entry.count}`);
    }
  }

  if (pairs.length > 0) {
    console.log('\n  top overlap pairs:');
    for (const pair of pairs.slice(0, 15)) {
      console.log(
        `    - ${pair.score.toFixed(3)} ${basename(pair.a.file)} ↔ ${basename(pair.b.file)}`,
      );
    }
  }

  if (components.length > 0) {
    console.log('\n  candidate batch-processing clusters:');
    for (const cluster of components.slice(0, 10)) {
      console.log(`    - (${cluster.length}) ${cluster.join(', ')}`);
    }
    console.log(
      '\n  recommendation: extract shared scanners/allowlist loaders for these clusters before adding more one-off guards.',
    );
  } else {
    console.log('\n✓ No multi-file overlap clusters above threshold.');
  }

  return 0;
}

process.exitCode = run();

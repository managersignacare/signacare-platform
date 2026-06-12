import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const REPO_ROOT = path.resolve(__dirname, '../../..');
export const MANIFEST_DIR = path.join(REPO_ROOT, 'repo-split', 'manifests');

const GLOBAL_EXCLUDE_PREFIXES = [
  '.git/',
  'node_modules/',
  'artifacts/',
  'audit-reports/',
  'backups/',
  'test-results/',
];

const GLOBAL_EXACT_EXCLUDES = new Set([
  '.DS_Store',
]);

function normalizePath(input) {
  return input.split(path.sep).join('/');
}

function ensureTrailingSlash(input) {
  return input.endsWith('/') ? input : `${input}/`;
}

export function loadSplitManifests() {
  const files = fs
    .readdirSync(MANIFEST_DIR)
    .filter((entry) => entry.endsWith('.json'))
    .sort();

  return files.map((fileName) => {
    const absolutePath = path.join(MANIFEST_DIR, fileName);
    const parsed = JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
    return {
      ...parsed,
      absolutePath,
      repoScaffoldPath: parsed.repoScaffoldPath ?? null,
      pathTransform: parsed.pathTransform ?? {},
      ownership: {
        include: parsed.ownership?.include ?? [],
        exclude: parsed.ownership?.exclude ?? [],
      },
    };
  });
}

export function validateManifestShape(manifest) {
  const errors = [];
  if (manifest.version !== 1) errors.push('version must be 1');
  if (typeof manifest.repoName !== 'string' || manifest.repoName.trim().length === 0) {
    errors.push('repoName must be a non-empty string');
  }
  if (manifest.repoScaffoldPath !== null && typeof manifest.repoScaffoldPath !== 'string') {
    errors.push('repoScaffoldPath must be a string when provided');
  }
  if (manifest.pathTransform?.stripPrefix && typeof manifest.pathTransform.stripPrefix !== 'string') {
    errors.push('pathTransform.stripPrefix must be a string when provided');
  }
  if (!manifest.ownership || !Array.isArray(manifest.ownership.include) || manifest.ownership.include.length === 0) {
    errors.push('ownership.include must be a non-empty array');
  }
  if (!Array.isArray(manifest.ownership.exclude)) {
    errors.push('ownership.exclude must be an array');
  }
  return errors;
}

export function listRepoFiles(rootDir = REPO_ROOT) {
  const files = [];

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = normalizePath(path.relative(rootDir, absolutePath));
      if (!relativePath) continue;
      if (entry.isSymbolicLink()) continue;

      if (entry.isDirectory()) {
        const prefix = ensureTrailingSlash(relativePath);
        if (GLOBAL_EXCLUDE_PREFIXES.some((excluded) => prefix.startsWith(excluded))) continue;
        walk(absolutePath);
        continue;
      }

      if (GLOBAL_EXACT_EXCLUDES.has(path.basename(relativePath))) continue;
      if (GLOBAL_EXCLUDE_PREFIXES.some((excluded) => relativePath.startsWith(excluded))) continue;
      files.push(relativePath);
    }
  }

  walk(rootDir);
  return files.sort();
}

function matchesOwnershipEntry(relativePath, entry) {
  if (entry.endsWith('/')) return relativePath.startsWith(entry);
  return relativePath === entry;
}

export function manifestOwnsPath(manifest, relativePath) {
  const included = manifest.ownership.include.some((entry) => matchesOwnershipEntry(relativePath, entry));
  if (!included) return false;
  const excluded = manifest.ownership.exclude.some((entry) => matchesOwnershipEntry(relativePath, entry));
  return !excluded;
}

export function projectPathForManifest(manifest, relativePath) {
  const stripPrefix = manifest.pathTransform?.stripPrefix;
  if (!stripPrefix) return relativePath;
  if (!relativePath.startsWith(stripPrefix)) {
    throw new Error(
      `Path '${relativePath}' does not start with stripPrefix '${stripPrefix}' for ${manifest.repoName}`,
    );
  }
  return relativePath.slice(stripPrefix.length);
}

export function buildOwnershipReport(manifests, files = listRepoFiles()) {
  const ownership = new Map();
  for (const manifest of manifests) {
    ownership.set(manifest.repoName, []);
  }

  const conflicts = [];
  for (const relativePath of files) {
    const owners = manifests.filter((manifest) => manifestOwnsPath(manifest, relativePath));
    if (owners.length === 0) continue;
    if (owners.length > 1) {
      conflicts.push({
        path: relativePath,
        owners: owners.map((owner) => owner.repoName),
      });
      continue;
    }
    ownership.get(owners[0].repoName).push(relativePath);
  }

  return { ownership, conflicts, filesScanned: files.length };
}

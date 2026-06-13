import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, execSync } from 'child_process';
import { REPO_ROOT } from './manifests.mjs';

export const TARGET_REPOS = {
  'signacare-platform': {
    dir: path.resolve(REPO_ROOT, '..', 'signacare-platform'),
    expectedBranch: 'main',
    expectedUpstream: 'origin/main',
    expectedOrigins: [
      'git@github-managersignacare:managersignacare/signacare-platform.git',
      'git@github.com:managersignacare/signacare-platform.git',
      'https://github.com/managersignacare/signacare-platform.git',
    ],
  },
  'signacare-sara': {
    dir: path.resolve(REPO_ROOT, '..', 'signacare-sara'),
    expectedBranch: 'main',
    expectedUpstream: 'origin/main',
    expectedOrigins: [
      'git@github-managersignacare:managersignacare/signacare-sara.git',
      'git@github.com:managersignacare/signacare-sara.git',
      'https://github.com/managersignacare/signacare-sara.git',
    ],
  },
  'signacare-viva': {
    dir: path.resolve(REPO_ROOT, '..', 'signacare-viva'),
    expectedBranch: 'main',
    expectedUpstream: 'origin/main',
    expectedOrigins: [
      'git@github-managersignacare:managersignacare/signacare-viva.git',
      'git@github.com:managersignacare/signacare-viva.git',
      'https://github.com/managersignacare/signacare-viva.git',
    ],
  },
};

const EPHEMERAL_PATH_EXCLUDES = [
  '.git',
  '.DS_Store',
  'node_modules',
  '.vite',
  'dist',
  'coverage',
  '.turbo',
  'split-sync-status.json',
];

function formatExpectedOrigins(origins) {
  return origins.map((origin) => `'${origin}'`).join(', ');
}

function runGit(repoDir, args, options = {}) {
  return execFileSync('git', args, {
    cwd: repoDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

export function ensureGitRepo(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    throw new Error(`${repoDir} is not a git repository`);
  }
}

export function isGitClean(repoDir) {
  return runGit(repoDir, ['status', '--short']).length === 0;
}

export function getGitContext(repoDir) {
  ensureGitRepo(repoDir);
  const branch = runGit(repoDir, ['branch', '--show-current']);
  const commit = runGit(repoDir, ['rev-parse', 'HEAD']);
  const origin = runGit(repoDir, ['remote', 'get-url', 'origin']);
  let upstream = '';
  try {
    upstream = runGit(repoDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  } catch {
    upstream = '';
  }

  return { branch, commit, origin, upstream };
}

export function fetchOrigin(repoDir) {
  try {
    execFileSync('git', ['fetch', 'origin', '--prune'], {
      cwd: repoDir,
      stdio: 'inherit',
    });
  } catch {
    throw new Error(
      `Unable to fetch origin for ${repoDir}. Check network access and GitHub credentials, or rerun with --skip-fetch for local-only verification.`,
    );
  }
}

export function getAheadBehind(repoDir, upstreamRef) {
  if (!upstreamRef) return { ahead: 0, behind: 0 };
  const counts = runGit(repoDir, ['rev-list', '--left-right', '--count', `HEAD...${upstreamRef}`]);
  const [aheadRaw, behindRaw] = counts.split(/\s+/);
  return {
    ahead: Number.parseInt(aheadRaw ?? '0', 10),
    behind: Number.parseInt(behindRaw ?? '0', 10),
  };
}

export function backupRepoWorkingTree(repoDir, backupRoot) {
  const repoName = path.basename(repoDir);
  fs.mkdirSync(backupRoot, { recursive: true });
  const archivePath = path.join(backupRoot, `${repoName}.tar.gz`);
  execFileSync(
    'tar',
    ['-czf', archivePath, '--exclude=.git', '-C', repoDir, '.'],
    { stdio: 'inherit' },
  );
  return archivePath;
}

export function syncMaterializedRepo(sourceDir, targetDir) {
  const excludes = EPHEMERAL_PATH_EXCLUDES.flatMap((pattern) => ['--exclude', `${pattern}/`]);
  execFileSync(
    'rsync',
    [
      '-a',
      '--delete',
      ...excludes,
      `${sourceDir}/`,
      `${targetDir}/`,
    ],
    { stdio: 'inherit' },
  );
}

export function compareMaterializedRepo(sourceDir, targetDir) {
  const sourceMetadataPath = path.join(sourceDir, 'split-sync-status.json');
  const targetMetadataPath = path.join(targetDir, 'split-sync-status.json');

  if (!compareSplitSyncMetadata(sourceMetadataPath, targetMetadataPath)) {
    return `Files ${sourceMetadataPath} and ${targetMetadataPath} differ (excluding generatedAt).`;
  }

  try {
    const excludes = EPHEMERAL_PATH_EXCLUDES.flatMap((pattern) => ['-x', pattern]);
    execFileSync(
      'diff',
      ['-qr', ...excludes, sourceDir, targetDir],
      { stdio: 'pipe' },
    );
    return '';
  } catch (error) {
    return error.stdout?.toString() || error.stderr?.toString() || 'Directories differ.';
  }
}

function compareSplitSyncMetadata(sourcePath, targetPath) {
  const sourceExists = fs.existsSync(sourcePath);
  const targetExists = fs.existsSync(targetPath);
  if (!sourceExists || !targetExists) {
    return sourceExists === targetExists;
  }

  const normalize = (value) => {
    const clone = JSON.parse(JSON.stringify(value));
    delete clone.generatedAt;
    return clone;
  };

  const source = normalize(JSON.parse(fs.readFileSync(sourcePath, 'utf8')));
  const target = normalize(JSON.parse(fs.readFileSync(targetPath, 'utf8')));
  return JSON.stringify(source) === JSON.stringify(target);
}

export function buildSyncMetadata(manifest, sourceContext) {
  return {
    version: 1,
    syncMode: 'one-way-authoritative-copy',
    generatedAt: new Date().toISOString(),
    source: {
      repoRoot: REPO_ROOT,
      remote: sourceContext.origin,
      branch: sourceContext.branch,
      commit: sourceContext.commit,
    },
    target: {
      repoName: manifest.repoName,
      directory: TARGET_REPOS[manifest.repoName]?.dir ?? null,
    },
    manifest: {
      repoName: manifest.repoName,
      absolutePath: manifest.absolutePath,
      version: manifest.version,
      authoritativeSource: manifest.authoritativeSource ?? 'original-monorepo',
    },
  };
}

export function writeSyncMetadata(repoDir, metadata) {
  fs.writeFileSync(
    path.join(repoDir, 'split-sync-status.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8',
  );
}

export function createTempSyncDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function buildBackupRoot() {
  return path.resolve(
    REPO_ROOT,
    '..',
    'Archives',
    `signacare-repo-split-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  );
}

export function assertCleanSourceRepo(repoDir) {
  if (!isGitClean(repoDir)) {
    throw new Error(
      `${repoDir} has uncommitted changes; commit or stash before running authoritative repo sync`,
    );
  }
}

export function validateTargetRepo(manifest, { fetch = true } = {}) {
  const target = TARGET_REPOS[manifest.repoName];
  if (!target) {
    throw new Error(`No target directory configured for ${manifest.repoName}`);
  }

  ensureGitRepo(target.dir);
  if (!isGitClean(target.dir)) {
    throw new Error(`${target.dir} has uncommitted changes; refusing to overwrite`);
  }

  const initial = getGitContext(target.dir);
  if (initial.branch !== target.expectedBranch) {
    throw new Error(`${target.dir} is on '${initial.branch}', expected '${target.expectedBranch}'`);
  }
  if (initial.upstream !== target.expectedUpstream) {
    throw new Error(`${target.dir} tracks '${initial.upstream || '(none)'}', expected '${target.expectedUpstream}'`);
  }
  if (!target.expectedOrigins.includes(initial.origin)) {
    throw new Error(
      `${target.dir} origin is '${initial.origin}', expected one of ${formatExpectedOrigins(target.expectedOrigins)}`,
    );
  }

  if (fetch) {
    fetchOrigin(target.dir);
  }

  const afterFetch = getGitContext(target.dir);
  const drift = getAheadBehind(target.dir, afterFetch.upstream);
  if (drift.ahead !== 0 || drift.behind !== 0) {
    throw new Error(
      `${target.dir} is not aligned with ${afterFetch.upstream} (ahead ${drift.ahead}, behind ${drift.behind}); sync aborted`,
    );
  }

  return { ...target, git: afterFetch };
}

export function runNodeScript(scriptPath, args, cwd) {
  execFileSync('node', [scriptPath, ...args], { cwd, stdio: 'inherit' });
}

export function printSyncSummary(lines) {
  for (const line of lines) {
    console.log(line);
  }
}

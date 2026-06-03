/**
 * S5.3 — audioRetentionScheduler unit tests
 *
 * Pure-function tests for purgeOldAudioFiles + getAudioRetentionDays.
 * Uses a tmpdir + seed files with backdated mtimes; no mocks needed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  purgeOldAudioFiles,
  walkAudioFiles,
  getAudioRetentionDays,
} from '../src/jobs/schedulers/audioRetentionScheduler';

let tmpRoot: string;

function seedAudioFile(relPath: string, mtimeMs: number, content = 'fake-audio'): string {
  const full = path.join(tmpRoot, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  fs.utimesSync(full, new Date(mtimeMs), new Date(mtimeMs));
  return full;
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'signacare-audio-test-'));
});

afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
});

describe('walkAudioFiles', () => {
  it('returns empty for a non-existent directory', () => {
    const items = Array.from(walkAudioFiles(path.join(tmpRoot, 'no-such-dir')));
    expect(items).toEqual([]);
  });

  it('walks nested year/month subdirectories', () => {
    seedAudioFile('2026/03/a.webm', Date.now());
    seedAudioFile('2026/04/b.webm', Date.now());
    seedAudioFile('2026/04/c.webm', Date.now());
    const items = Array.from(walkAudioFiles(tmpRoot));
    expect(items).toHaveLength(3);
    const filenames = items.map((i) => path.basename(i.filePath)).sort();
    expect(filenames).toEqual(['a.webm', 'b.webm', 'c.webm']);
  });

  it('reports each file size', () => {
    seedAudioFile('test.webm', Date.now(), 'twelve-bytes');
    const items = Array.from(walkAudioFiles(tmpRoot));
    expect(items[0].size).toBe('twelve-bytes'.length);
  });
});

describe('purgeOldAudioFiles', () => {
  const now = Date.UTC(2026, 3, 11, 12, 0, 0); // 2026-04-11T12:00:00Z

  it('deletes files older than the retention window', () => {
    const old = seedAudioFile('2026/01/old.webm', now - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    const fresh = seedAudioFile('2026/04/fresh.webm', now - 1 * 24 * 60 * 60 * 1000); // 1 day ago

    const stats = purgeOldAudioFiles(tmpRoot, 30, now);

    expect(stats.scanned).toBe(2);
    expect(stats.deleted).toBe(1);
    expect(stats.errors).toBe(0);
    expect(stats.bytesFreed).toBe('fake-audio'.length);
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('keeps a file exactly at the boundary', () => {
    const exactlyAtCutoff = seedAudioFile('2026/03/border.webm', now - 30 * 24 * 60 * 60 * 1000);
    const stats = purgeOldAudioFiles(tmpRoot, 30, now);
    // mtime < cutoff is the rule, so a file mtime exactly equal to
    // the cutoff is NOT deleted.
    expect(stats.deleted).toBe(0);
    expect(fs.existsSync(exactlyAtCutoff)).toBe(true);
  });

  it('returns zero stats for an empty directory', () => {
    const stats = purgeOldAudioFiles(tmpRoot, 30, now);
    expect(stats).toEqual({ scanned: 0, deleted: 0, errors: 0, bytesFreed: 0 });
  });

  it('returns zero stats for a non-existent root', () => {
    const stats = purgeOldAudioFiles(path.join(tmpRoot, 'missing'), 30, now);
    expect(stats.scanned).toBe(0);
    expect(stats.deleted).toBe(0);
  });

  it('respects different retention windows', () => {
    const ten = seedAudioFile('a.webm', now - 10 * 24 * 60 * 60 * 1000);
    const fifty = seedAudioFile('b.webm', now - 50 * 24 * 60 * 60 * 1000);

    // 30-day window: only the 50-day file goes
    expect(purgeOldAudioFiles(tmpRoot, 30, now).deleted).toBe(1);
    expect(fs.existsSync(ten)).toBe(true);
    expect(fs.existsSync(fifty)).toBe(false);

    // re-seed and try a 7-day window: both go
    seedAudioFile('a.webm', now - 10 * 24 * 60 * 60 * 1000);
    seedAudioFile('b.webm', now - 50 * 24 * 60 * 60 * 1000);
    expect(purgeOldAudioFiles(tmpRoot, 7, now).deleted).toBe(2);
  });
});

describe('getAudioRetentionDays', () => {
  it('defaults to 30 when env var is unset', () => {
    delete process.env.AUDIO_RETENTION_DAYS;
    expect(getAudioRetentionDays()).toBe(30);
  });

  it('uses the env var when valid', () => {
    process.env.AUDIO_RETENTION_DAYS = '7';
    expect(getAudioRetentionDays()).toBe(7);
    delete process.env.AUDIO_RETENTION_DAYS;
  });

  it('falls back to 30 on garbage input', () => {
    process.env.AUDIO_RETENTION_DAYS = 'banana';
    expect(getAudioRetentionDays()).toBe(30);
    delete process.env.AUDIO_RETENTION_DAYS;
  });

  it('falls back to 30 on zero or negative', () => {
    process.env.AUDIO_RETENTION_DAYS = '0';
    expect(getAudioRetentionDays()).toBe(30);
    process.env.AUDIO_RETENTION_DAYS = '-5';
    expect(getAudioRetentionDays()).toBe(30);
    delete process.env.AUDIO_RETENTION_DAYS;
  });
});

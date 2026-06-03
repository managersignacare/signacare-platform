import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runGuard } from '../check-centralized-notification-emitter';

const TMP = join(tmpdir(), 'check-centralized-notification-emitter');

function write(rel: string, content: string): void {
  const full = join(TMP, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

beforeAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
});

describe('check-centralized-notification-emitter', () => {
  it('passes when direct emit calls only exist in allowed files', () => {
    write(
      'events/clinicalSignalEmitter.ts',
      `const notificationService = { emit: async () => ({ ids: [], published: false }) };
       async function ok() { await notificationService.emit({}); }`,
    );
    write(
      'notifications/notificationService.ts',
      `export const notificationService = { emit: async () => ({ ids: [], published: false }) };`,
    );
    write('messaging/messageRepository.ts', `export const x = 1;`);

    const out = runGuard({ featuresRoot: TMP });
    expect(out.violations).toHaveLength(0);
  });

  it('fails when a feature module uses notificationService.emit directly', () => {
    write(
      'referrals/referralService.ts',
      `async function bad(notificationService: { emit: (x: unknown) => Promise<unknown> }) {
         await notificationService.emit({});
       }`,
    );
    const out = runGuard({ featuresRoot: TMP });
    expect(out.violations.length).toBeGreaterThan(0);
    expect(out.violations[0]?.file).toContain('referrals/referralService.ts');
  });
});


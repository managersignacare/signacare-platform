import { describe, it, expect } from 'vitest';
import {
  orgId,
  clinicId,
  staffId,
  patientId,
  episodeId,
  noteId,
} from '../src/seed-good-health/config/ids';
import { createRng } from '../src/seed-good-health/lib/rng';

// Phase 0.8 determinism contract: every id helper and every rng draw
// must produce byte-identical output across runs. If these tests ever
// go red, reseeds stop being reproducible and grandfather-style "re-run
// and assert zero new rows" breaks.

describe('seed-good-health: deterministic ids', () => {
  it('orgId is stable across calls', () => {
    expect(orgId()).toBe(orgId());
  });

  it('different canonical names produce different uuids', () => {
    const a = clinicId('northern');
    const b = clinicId('eastern');
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('same canonical name produces same uuid (idempotency proof)', () => {
    expect(clinicId('northern')).toBe(clinicId('northern'));
    expect(staffId('northern', 'alpha-lead')).toBe(
      staffId('northern', 'alpha-lead'),
    );
  });

  it('derived ids compose stably through the chain', () => {
    const p = patientId('northern', 'alpha', 1);
    const e = episodeId(p, 1);
    const n = noteId(e, 0);
    expect(p).toBe(patientId('northern', 'alpha', 1));
    expect(e).toBe(episodeId(p, 1));
    expect(n).toBe(noteId(e, 0));
  });
});

describe('seed-good-health: seeded rng', () => {
  it('same seed produces identical sequences', () => {
    const r1 = createRng(42);
    const r2 = createRng(42);
    for (let i = 0; i < 16; i++) {
      expect(r1.nextFloat()).toBe(r2.nextFloat());
    }
  });

  it('different seeds diverge within 4 draws', () => {
    const r1 = createRng(1);
    const r2 = createRng(2);
    const s1 = [r1.nextFloat(), r1.nextFloat(), r1.nextFloat(), r1.nextFloat()];
    const s2 = [r2.nextFloat(), r2.nextFloat(), r2.nextFloat(), r2.nextFloat()];
    expect(s1).not.toEqual(s2);
  });

  it('fork derives stable child streams from a tag', () => {
    const parent = createRng(100);
    const forkA = parent.fork('alpha');
    const forkB = parent.fork('alpha');
    expect(forkA.nextFloat()).toBe(forkB.nextFloat());

    const forkC = parent.fork('beta');
    expect(forkA.nextFloat()).not.toBe(forkC.nextFloat());
  });

  it('nextInt respects inclusive bounds across 100 draws', () => {
    const rng = createRng(7);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });

  it('weighted picks respect the distribution', () => {
    const rng = createRng(12345);
    const counts = { heavy: 0, light: 0 };
    for (let i = 0; i < 1000; i++) {
      const v = rng.weighted([
        { value: 'heavy' as const, weight: 9 },
        { value: 'light' as const, weight: 1 },
      ]);
      counts[v]++;
    }
    expect(counts.heavy).toBeGreaterThan(counts.light * 5);
  });
});

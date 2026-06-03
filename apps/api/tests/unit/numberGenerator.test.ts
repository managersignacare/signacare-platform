import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  generateEpisodeNumber,
  generateInvoiceNumber,
  generatePatientNumber,
  generateReferralNumber,
} from '../../src/shared/utils/numberGenerator';

type RawCall = { sql: string; bindings: unknown[] };

function makeExecutor(nextValues: Array<number | string>) {
  const calls: RawCall[] = [];
  const raw = vi.fn(async (sql: string, bindings: unknown[]) => {
    calls.push({ sql, bindings });
    const next = nextValues.shift();
    return { rows: [{ next_value: next ?? 1 }] };
  });
  return { executor: { raw }, calls };
}

describe('numberGenerator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('generates padded patient and episode numbers from atomic sequence rows', async () => {
    const { executor, calls } = makeExecutor([12, 305]);

    const patient = await generatePatientNumber('clinic-a', executor as never);
    const episode = await generateEpisodeNumber('clinic-a', executor as never);

    expect(patient).toBe('P000012');
    expect(episode).toBe('E000305');
    expect(calls[0]?.bindings).toEqual(['clinic-a', 'patient_number']);
    expect(calls[1]?.bindings).toEqual(['clinic-a', 'episode_number']);
  });

  it('generates year-scoped referral numbers', async () => {
    vi.setSystemTime(new Date('2026-08-14T10:00:00.000Z'));
    const { executor, calls } = makeExecutor([9]);

    const referral = await generateReferralNumber('clinic-b', executor as never);

    expect(referral).toBe('REF-2026-000009');
    expect(calls[0]?.bindings).toEqual(['clinic-b', 'referral_number:2026']);
  });

  it('generates day-scoped invoice numbers', async () => {
    vi.setSystemTime(new Date('2026-01-03T23:59:59.000Z'));
    const { executor, calls } = makeExecutor([41]);

    const invoice = await generateInvoiceNumber('clinic-c', executor as never);

    expect(invoice).toBe('INV-20260103-000041');
    expect(calls[0]?.bindings).toEqual(['clinic-c', 'invoice_number:20260103']);
  });
});

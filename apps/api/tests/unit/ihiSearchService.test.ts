import { describe, expect, it } from 'vitest';
import type { IhiResult, IhiSearchParams } from '../../src/integrations/hiService/hiServiceClient';
import {
  buildIhiSearchCandidates,
  searchIhiWithPriority,
} from '../../src/features/prescriptions/ihiSearchPriority';

function baseParams(): IhiSearchParams {
  return {
    familyName: 'Smith',
    givenName: 'Jane',
    dateOfBirth: '1985-01-01',
    gender: 'F',
  };
}

describe('BUG-A5.4 IHI search priority + conflict handling', () => {
  it('T1 — builds search candidates in priority order (medicare -> dva -> contact)', () => {
    const candidates = buildIhiSearchCandidates({
      ...baseParams(),
      medicareNumber: '29500003411',
      medicareIrn: '1',
      dvaNumber: 'QX123456',
      mobile: '+61400000000',
      email: 'patient@example.test',
    });
    expect(candidates.map((candidate) => candidate.path)).toEqual(['medicare', 'dva', 'contact']);
  });

  it('T2 — returns a deterministic validation error when no identity path is provided', async () => {
    const outcome = await searchIhiWithPriority(baseParams(), async () => ({ found: false }));
    expect(outcome.result.found).toBe(false);
    expect(outcome.result.error).toMatch(/Provide one identity path/i);
    expect(outcome.attempts).toHaveLength(0);
  });

  it('T3 — chooses medicare result when it is the only successful path', async () => {
    const responses: IhiResult[] = [
      { found: true, ihi: '8003608833357361', ihiRecordStatus: 'verified', ihiStatus: 'active' },
      { found: false, error: 'not found' },
      { found: false, error: 'not found' },
    ];
    let index = 0;
    const outcome = await searchIhiWithPriority(
      {
        ...baseParams(),
        medicareNumber: '29500003411',
        medicareIrn: '1',
        dvaNumber: 'QX123456',
        email: 'patient@example.test',
      },
      async () => responses[index++] ?? { found: false, error: 'unexpected call' },
    );

    expect(outcome.result.found).toBe(true);
    expect(outcome.result.ihi).toBe('8003608833357361');
    expect(outcome.winningPath).toBe('medicare');
    expect(outcome.conflict).toBeNull();
  });

  it('T4 — falls back to DVA when medicare path does not resolve an IHI', async () => {
    const responses: IhiResult[] = [
      { found: false, error: 'no medicare match' },
      { found: true, ihi: '8003601111111111', ihiRecordStatus: 'verified', ihiStatus: 'active' },
    ];
    let index = 0;
    const outcome = await searchIhiWithPriority(
      {
        ...baseParams(),
        medicareNumber: '29500003411',
        medicareIrn: '1',
        dvaNumber: 'QX123456',
      },
      async () => responses[index++] ?? { found: false, error: 'unexpected call' },
    );

    expect(outcome.result.found).toBe(true);
    expect(outcome.result.ihi).toBe('8003601111111111');
    expect(outcome.winningPath).toBe('dva');
    expect(outcome.attempts).toHaveLength(2);
  });

  it('T5 — fail-closes when two successful paths resolve different IHIs', async () => {
    const responses: IhiResult[] = [
      { found: true, ihi: '8003602222222222', ihiRecordStatus: 'verified', ihiStatus: 'active' },
      { found: true, ihi: '8003603333333333', ihiRecordStatus: 'verified', ihiStatus: 'active' },
    ];
    let index = 0;
    const outcome = await searchIhiWithPriority(
      {
        ...baseParams(),
        medicareNumber: '29500003411',
        medicareIrn: '1',
        dvaNumber: 'QX123456',
      },
      async () => responses[index++] ?? { found: false, error: 'unexpected call' },
    );

    expect(outcome.result.found).toBe(false);
    expect(outcome.result.error).toMatch(/HI identity conflict across search paths/i);
    expect(outcome.winningPath).toBeNull();
    expect(outcome.conflict).toMatchObject({
      winnerPath: 'medicare',
      conflictingPath: 'dva',
    });
  });
});

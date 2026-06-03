import { describe, expect, it } from 'vitest';
import { adminReportKeys } from './queryKeys';

describe('adminReportKeys', () => {
  it('scopes overview keys by clinic id', () => {
    const filters = {
      period: 'month',
      teamId: undefined,
      clinicianId: undefined,
      from: undefined,
      to: undefined,
    };

    const a = adminReportKeys.overview('clinic-a', filters);
    const b = adminReportKeys.overview('clinic-b', filters);

    expect(a).not.toEqual(b);
    expect(a[0]).toBe('admin-report');
    expect(a[1]).toBe('clinic-a');
    expect(b[1]).toBe('clinic-b');
  });

  it('includes metric and limit in details keys', () => {
    const key = adminReportKeys.details(
      'clinic-a',
      'total_consumers',
      200,
      { period: 'month' },
    );
    expect(key[0]).toBe('admin-report');
    expect(key[2]).toBe('details');
    expect(key[3]).toBe('total_consumers');
    expect(key[4]).toBe(200);
  });
});

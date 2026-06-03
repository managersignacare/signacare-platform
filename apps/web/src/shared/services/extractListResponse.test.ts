import { describe, expect, it } from 'vitest';
import { extractListResponse } from './extractListResponse';

describe('extractListResponse', () => {
  it('returns raw array payload as-is', () => {
    const input = [{ id: 1 }, { id: 2 }];
    expect(extractListResponse<{ id: number }>(input)).toEqual(input);
  });

  it('extracts array from the default `data` key', () => {
    const input = { data: [{ id: 'a' }] };
    expect(extractListResponse<{ id: string }>(input)).toEqual([{ id: 'a' }]);
  });

  it('extracts array from custom keys in precedence order', () => {
    const input = { appointments: [{ id: 'x' }], data: [{ id: 'y' }] };
    expect(
      extractListResponse<{ id: string }>(input, { keys: ['appointments', 'data'] }),
    ).toEqual([{ id: 'x' }]);
  });

  it('throws on unsupported payload shape', () => {
    expect(() =>
      extractListResponse<{ id: string }>({ ok: true }, { endpoint: 'appointments' }),
    ).toThrow(/Unexpected list response shape/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  formatLiveTranscriptCadence,
  resolveLiveTranscriptBatchMs,
} from './scribeLiveTranscriptConfig';

describe('scribeLiveTranscriptConfig', () => {
  it('defaults to a faster 3-second cadence when env is unset or invalid', () => {
    expect(resolveLiveTranscriptBatchMs(undefined)).toBe(3000);
    expect(resolveLiveTranscriptBatchMs('abc')).toBe(3000);
  });

  it('clamps the cadence to safe bounds for chunk decodability and backend load', () => {
    expect(resolveLiveTranscriptBatchMs(500)).toBe(2000);
    expect(resolveLiveTranscriptBatchMs(15000)).toBe(10000);
  });

  it('formats whole-second cadence labels cleanly for the recorder UI', () => {
    expect(formatLiveTranscriptCadence(3000)).toBe('Updates every 3 seconds');
    expect(formatLiveTranscriptCadence(2000)).toBe('Updates every 2 seconds');
  });
});

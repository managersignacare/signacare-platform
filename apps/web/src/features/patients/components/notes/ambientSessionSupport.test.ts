import { describe, expect, it } from 'vitest';
import { isAmbientScribeSessionActive } from './ambientSessionSupport';

describe('ambientSessionSupport', () => {
  it('treats active recording as session-protected work', () => {
    expect(isAmbientScribeSessionActive(true, false)).toBe(true);
  });

  it('treats active server-side processing as session-protected work', () => {
    expect(isAmbientScribeSessionActive(false, true)).toBe(true);
  });

  it('drops back to normal idle semantics when neither recording nor processing', () => {
    expect(isAmbientScribeSessionActive(false, false)).toBe(false);
  });
});

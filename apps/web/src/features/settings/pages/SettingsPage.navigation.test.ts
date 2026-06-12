import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SettingsPage navigation', () => {
  const source = readFileSync(resolve(__dirname, './SettingsPage.tsx'), 'utf8');

  it('does not expose Dashboard Options as a standalone settings tab', () => {
    expect(source).not.toContain('label="Dashboard Options"');
    expect(source).not.toContain("value=\"dashboard-options\"");
    expect(source).not.toContain("tab === 'dashboard-options'");
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('SettingsPage navigation', () => {
  const source = readFileSync(resolve(__dirname, './SettingsPage.tsx'), 'utf8');

  it('exposes the alternative dashboard chooser as its own settings tab next to appearance', () => {
    expect(source).toContain('label="Alternative Dashboard"');
    expect(source).toContain('value="dashboard-options"');
    expect(source).toContain("tab === 'dashboard-options'");
  });
});

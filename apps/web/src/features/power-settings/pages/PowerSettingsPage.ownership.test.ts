import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PowerSettingsPage ownership boundaries', () => {
  const source = readFileSync(resolve(__dirname, './PowerSettingsPage.tsx'), 'utf8');

  it('owns the governance and backup tabs moved out of org settings', () => {
    expect(source).toContain('label="Clinical Policies"');
    expect(source).toContain('label="Workflow Builder"');
    expect(source).toContain('label="Access Control"');
    expect(source).toContain('label="Audit Log"');
    expect(source).toContain('label="Backup Settings"');
  });
});

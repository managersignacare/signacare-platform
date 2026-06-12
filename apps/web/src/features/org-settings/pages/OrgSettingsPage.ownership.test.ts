import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('OrgSettingsPage ownership boundaries', () => {
  const source = readFileSync(resolve(__dirname, './OrgSettingsPage.tsx'), 'utf8');

  it('does not expose power-only governance tabs inside org settings', () => {
    expect(source).not.toContain('label="Clinical Policies"');
    expect(source).not.toContain('label="Workflow Builder"');
    expect(source).not.toContain('label="Access Control"');
    expect(source).not.toContain('label="Audit Log"');
    expect(source).not.toContain('label="Backup Settings"');
  });

  it('tells operators that governance controls live in power settings', () => {
    expect(source).toContain('managed in Power Settings');
  });
});

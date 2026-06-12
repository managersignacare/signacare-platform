import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PatientDetailLayout documentation flow wiring', () => {
  const source = readFileSync(resolve(__dirname, './PatientDetailLayout.tsx'), 'utf8');

  it('routes banner note and report actions into the documentation tab', () => {
    expect(source).toContain("label: 'Write Note'");
    expect(source).toContain("label: 'Write Report'");
    expect(source).toContain("tab: 'documentation' as PatientTabId");
    expect(source).toContain("docAction: 'note' as const");
    expect(source).toContain("docAction: 'report' as const");
  });

  it('stores documentation deep links in the patient-detail search params', () => {
    expect(source).toContain("next.set('tab', 'documentation')");
    expect(source).toContain("next.set('docAction', action)");
    expect(source).toContain("next.delete('docAction')");
  });
});

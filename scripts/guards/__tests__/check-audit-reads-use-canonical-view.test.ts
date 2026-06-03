import { describe, expect, it } from 'vitest';
import { runGuard, type Target } from '../check-audit-reads-use-canonical-view';

function makeTargets(content: string): Target[] {
  return [
    { path: 'a.ts', label: 'A', content },
    { path: 'b.ts', label: 'B', content },
    { path: 'c.ts', label: 'C', content },
  ];
}

describe('check-audit-reads-use-canonical-view', () => {
  it('passes when targets read from audit_events_canonical only', () => {
    const result = runGuard({
      targets: makeTargets("const q = db('audit_events_canonical').where({ clinic_id: clinicId });"),
    });

    expect(result.exitCode).toBe(0);
    expect(result.violations).toHaveLength(0);
    expect(result.missingCanonical).toHaveLength(0);
    expect(result.nonNormalizedActionFilters).toHaveLength(0);
  });

  it('fails when any target reads audit_log directly', () => {
    const result = runGuard({
      targets: [
        {
          path: 'audit.ts',
          label: 'Audit',
          content: "const q = db('audit_log').where({ clinic_id: clinicId }); const ok = db('audit_events_canonical');",
        },
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain("contains raw audit_log read");
    expect(result.nonNormalizedActionFilters).toHaveLength(0);
  });

  it('fails when canonical view is missing even if raw audit_log is absent', () => {
    const result = runGuard({
      targets: [
        {
          path: 'audit.ts',
          label: 'Audit',
          content: "const q = db('patients').where({ clinic_id: clinicId });",
        },
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(0);
    expect(result.missingCanonical).toHaveLength(1);
    expect(result.missingCanonical[0]).toContain('does not reference audit_events_canonical');
    expect(result.nonNormalizedActionFilters).toHaveLength(0);
  });

  it('fails when action predicates are not UPPER-normalized', () => {
    const result = runGuard({
      targets: [
        {
          path: 'audit.ts',
          label: 'Audit',
          content:
            "const q = db('audit_events_canonical').whereRaw(\"COALESCE(operation, action) = 'FORBIDDEN_ACCESS'\");",
        },
      ],
    });

    expect(result.exitCode).toBe(1);
    expect(result.violations).toHaveLength(0);
    expect(result.missingCanonical).toHaveLength(0);
    expect(result.nonNormalizedActionFilters).toHaveLength(1);
    expect(result.nonNormalizedActionFilters[0]).toContain('without UPPER() normalization');
  });
});

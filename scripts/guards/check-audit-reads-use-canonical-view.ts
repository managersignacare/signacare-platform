import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pathToFileURL } from 'url';

export type Target = {
  path: string;
  label: string;
  content?: string;
};

const REPO_ROOT = resolve(__dirname, '..', '..');

const TARGETS: Target[] = [
  {
    path: 'apps/api/src/features/audit/auditReplayRoutes.ts',
    label: 'Audit replay timelines',
  },
  {
    path: 'apps/api/src/features/staff-settings/staffSettingsRoutes.ts',
    label: 'Staff settings audit log endpoint',
  },
  {
    path: 'apps/api/src/features/reports/complianceDashboardRoutes.ts',
    label: 'Compliance governance dashboard',
  },
  {
    path: 'apps/api/src/middleware/superadminGuard.ts',
    label: 'Superadmin 4-eyes approval verification',
  },
  {
    path: 'apps/api/src/server.ts',
    label: 'Audit API endpoint',
  },
  {
    path: 'apps/api/src/jobs/schedulers/clinicAdminSlotBootstrapCheck.ts',
    label: 'Clinic admin slot bootstrap dedupe',
  },
];

const RAW_AUDIT_LOG_PATTERNS = [
  "db('audit_log",
  'db("audit_log',
  "dbAdmin('audit_log",
  'dbAdmin("audit_log',
];

export interface GuardResult {
  exitCode: number;
  targets: number;
  violations: string[];
  missingCanonical: string[];
  nonNormalizedActionFilters: string[];
}

export function runGuard(options?: {
  repoRoot?: string;
  targets?: Target[];
}): GuardResult {
  const repoRoot = options?.repoRoot ?? REPO_ROOT;
  const targets = options?.targets ?? TARGETS;
  const violations: string[] = [];
  const missingCanonical: string[] = [];
  const nonNormalizedActionFilters: string[] = [];

  const actionPredicateRegex =
    /(UPPER\(\s*)?COALESCE\(\s*(?:[a-zA-Z_]+\.)?operation\s*,\s*(?:[a-zA-Z_]+\.)?action\s*\)\s*\)?\s*(?:=|IN)\s*/gi;

  for (const target of targets) {
    const content = target.content ?? readFileSync(resolve(repoRoot, target.path), 'utf-8');

    for (const pattern of RAW_AUDIT_LOG_PATTERNS) {
      if (content.includes(pattern)) {
        violations.push(`${target.path} (${target.label}) contains raw audit_log read: ${pattern}`);
      }
    }

    if (!content.includes('audit_events_canonical')) {
      missingCanonical.push(`${target.path} (${target.label}) does not reference audit_events_canonical`);
    }

    for (const match of content.matchAll(actionPredicateRegex)) {
      if (!match[1]) {
        nonNormalizedActionFilters.push(
          `${target.path} (${target.label}) uses COALESCE(operation, action) predicate without UPPER() normalization`,
        );
      }
    }
  }

  return {
    exitCode:
      violations.length === 0 &&
      missingCanonical.length === 0 &&
      nonNormalizedActionFilters.length === 0
        ? 0
        : 1,
    targets: targets.length,
    violations,
    missingCanonical,
    nonNormalizedActionFilters,
  };
}

function main(): number {
  const result = runGuard();

  console.log('→ check-audit-reads-use-canonical-view');
  console.log(`  targets:    ${result.targets}`);
  console.log(
    `  violations: ${
      result.violations.length + result.missingCanonical.length + result.nonNormalizedActionFilters.length
    }`,
  );

  if (result.exitCode === 0) {
    console.log('✓ Key audit read paths use audit_events_canonical and avoid raw audit_log reads.');
    return 0;
  }

  for (const v of result.violations) {
    console.error(`  ✗ ${v}`);
  }
  for (const v of result.missingCanonical) {
    console.error(`  ✗ ${v}`);
  }
  for (const v of result.nonNormalizedActionFilters) {
    console.error(`  ✗ ${v}`);
  }

  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}

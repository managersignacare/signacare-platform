#!/usr/bin/env tsx
/**
 * BUG-SA-008 — Queue/worker failure observability baseline guard.
 *
 * Enforces minimum failure-path instrumentation on production workers:
 *   1) non-stub workers must register a BullMQ `failed` handler
 *   2) failure handlers must log via `logger.error(...)`
 *   3) JobBus must retain failed jobs (`removeOnFail`) for DLQ triage
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type FileRule = {
  file: string;
  required: RegExp[];
  description: string;
};

const ROOT = resolve(__dirname, '..', '..');

const WORKER_RULES: FileRule[] = [
  {
    file: 'apps/api/src/jobs/workers/aiWorker.ts',
    required: [/\.on\('failed'/, /logger\.error\(/],
    description: 'AI worker emits structured failed-job telemetry',
  },
  {
    file: 'apps/api/src/jobs/workers/emailWorker.ts',
    required: [/\.on\('failed'/, /logger\.error\(/],
    description: 'Email worker emits structured failed-job telemetry',
  },
  {
    file: 'apps/api/src/jobs/workers/hl7Worker.ts',
    required: [/\.on\('failed'/, /logger\.error\(/],
    description: 'HL7 worker emits structured failed-job telemetry',
  },
  {
    file: 'apps/api/src/jobs/workers/outlookWorker.ts',
    required: [/\.on\('failed'/, /logger\.error\(/],
    description: 'Outlook worker emits structured failed-job telemetry',
  },
  {
    file: 'apps/api/src/jobs/workers/sessionCleanupWorker.ts',
    required: [/\.on\('failed'/, /logger\.error\(/],
    description: 'Session-cleanup worker emits structured failed-job telemetry',
  },
  {
    file: 'apps/api/src/features/patient-outreach/patientOutreachWorker.ts',
    required: [/\.on\('failed'/, /logger\.error\(/],
    description: 'Patient-outreach worker emits structured failed-job telemetry',
  },
];

const DLQ_RETENTION_RULE: FileRule = {
  file: 'apps/api/src/shared/jobBus.ts',
  required: [/removeOnFail:\s*50/],
  description: 'JobBus retains failed jobs for DLQ triage',
};

const STUB_RULES: FileRule[] = [
  {
    file: 'apps/api/src/jobs/workers/flagWorker.ts',
    required: [/Stub\s*—\s*worker not yet implemented/],
    description: 'flagWorker is explicitly tracked as a stub',
  },
  {
    file: 'apps/api/src/jobs/workers/llmWorker.ts',
    required: [/Stub\s*—\s*worker not yet implemented/],
    description: 'llmWorker is explicitly tracked as a stub',
  },
];

function verifyRule(rule: FileRule, failures: string[]): void {
  const absolute = resolve(ROOT, rule.file);
  const content = readFileSync(absolute, 'utf8');
  for (const pattern of rule.required) {
    if (!pattern.test(content)) {
      failures.push(`${rule.file}: missing pattern ${String(pattern)} (${rule.description})`);
    }
  }
}

function main(): void {
  const failures: string[] = [];
  for (const rule of WORKER_RULES) verifyRule(rule, failures);
  verifyRule(DLQ_RETENTION_RULE, failures);
  for (const rule of STUB_RULES) verifyRule(rule, failures);

  if (failures.length > 0) {
    console.error(`✗ worker failure observability guard failed (${failures.length} issue(s))`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(
    `✓ Worker failure observability baseline passed (` +
      `${WORKER_RULES.length} workers + DLQ retention + ${STUB_RULES.length} tracked stubs).`,
  );
}

main();

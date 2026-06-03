#!/usr/bin/env tsx
/**
 * BUG-278 mechanical guard.
 *
 * Enforces the deploy-time contract that prevents Ollama prompt logging drift:
 * 1) production env template must keep OLLAMA_DEBUG disabled
 * 2) deployment runbooks must include the probe command + explicit log-file input
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

const CONTRACTS: Array<{
  file: string;
  checks: Array<{ pattern: RegExp; reason: string }>;
}> = [
  {
    file: 'deploy/env.production.example',
    checks: [
      {
        pattern: /^\s*OLLAMA_DEBUG=false\s*$/m,
        reason: 'must set OLLAMA_DEBUG=false in production template',
      },
    ],
  },
  {
    file: 'docs/guides/deployment-guide.md',
    checks: [
      {
        pattern: /probe:ollama-log-hygiene/,
        reason: 'must include BUG-278 probe command',
      },
      {
        pattern: /OLLAMA_LOG_FILES=/,
        reason: 'must include explicit Ollama log file input',
      },
    ],
  },
  {
    file: 'docs/archive/audit-2026-04-19/follow-up-on-cloud-deploy.md',
    checks: [
      {
        pattern: /probe:ollama-log-hygiene/,
        reason: 'must include BUG-278 deploy verification step',
      },
      {
        pattern: /BUG-278 deploy verification/i,
        reason: 'must keep BUG-278 section title/documentation',
      },
    ],
  },
];

type Violation = { file: string; reason: string };

function main(): number {
  const violations: Violation[] = [];

  for (const contract of CONTRACTS) {
    const abs = resolve(ROOT, contract.file);
    let text = '';
    try {
      text = readFileSync(abs, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      violations.push({
        file: contract.file,
        reason: `file unreadable: ${msg}`,
      });
      continue;
    }

    for (const check of contract.checks) {
      if (!check.pattern.test(text)) {
        violations.push({
          file: contract.file,
          reason: check.reason,
        });
      }
    }
  }

  if (violations.length > 0) {
    console.error('✗ BUG-278 deploy contract violations detected:');
    for (const v of violations) {
      console.error(`  - ${relative(ROOT, resolve(ROOT, v.file))}: ${v.reason}`);
    }
    return 1;
  }

  console.log('✓ BUG-278 deploy contract is present (env + runbook + cloud follow-up).');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}


#!/usr/bin/env tsx
/**
 * BUG-SA-007 — route idempotency contract guard.
 *
 * Ensures high-risk multi-write routes keep explicit
 * `idempotencyMiddleware()` coverage.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type Rule = {
  file: string;
  description: string;
  pattern: RegExp;
};

const ROOT = resolve(__dirname, '..', '..');

const RULES: Rule[] = [
  // Billing multi-write routes
  {
    file: 'apps/api/src/features/billing/billingRoutes.ts',
    description: 'PUT /billing/accounts has idempotency middleware',
    pattern: /router\.put\(\s*'\/accounts'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/billing/billingRoutes.ts',
    description: 'POST /billing/invoices has idempotency middleware',
    pattern: /router\.post\(\s*'\/invoices'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/billing/billingRoutes.ts',
    description: 'DELETE /billing/invoices/:invoiceId has idempotency middleware',
    pattern: /router\.delete\(\s*'\/invoices\/:invoiceId'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/billing/billingRoutes.ts',
    description: 'POST /billing/payments has idempotency middleware',
    pattern: /router\.post\(\s*'\/payments'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/billing/billingRoutes.ts',
    description: 'PATCH /billing/payments/:paymentId/claim has idempotency middleware',
    pattern: /router\.patch\(\s*'\/payments\/:paymentId\/claim'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/billing/billingRoutes.ts',
    description: 'POST /billing/invoices/:invoiceId/approve has idempotency middleware',
    pattern: /router\.post\(\s*'\/invoices\/:invoiceId\/approve'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/billing/billingRoutes.ts',
    description: 'POST /billing/invoices/:invoiceId/send has idempotency middleware',
    pattern: /router\.post\(\s*'\/invoices\/:invoiceId\/send'[\s\S]*?idempotencyMiddleware\(\)/,
  },

  // Referral write-command routes
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/triage has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/triage'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/assign has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/assign'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/accept has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/accept'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/decline has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/decline'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/notes has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/notes'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'PATCH /referrals/:id has idempotency middleware',
    pattern: /router\.patch\(\s*'\/:id'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'PATCH /referrals/by-episode/:episodeId has idempotency middleware',
    pattern: /router\.patch\(\s*'\/by-episode\/:episodeId'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/by-episode/:episodeId/decision has idempotency middleware',
    pattern: /router\.post\(\s*'\/by-episode\/:episodeId\/decision'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/decision has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/decision'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/attachments has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/attachments'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/ocr-confirm has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/ocr-confirm'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/allocate has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/allocate'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/broadcast has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/broadcast'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/offers/:offerId/respond has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/offers\/:offerId\/respond'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'POST /referrals/:id/clarification has idempotency middleware',
    pattern: /router\.post\(\s*'\/:id\/clarification'[\s\S]*?idempotencyMiddleware\(\)/,
  },
  {
    file: 'apps/api/src/features/referrals/referralRoutes.ts',
    description: 'PATCH /referrals/:id/clarification-response has idempotency middleware',
    pattern: /router\.patch\(\s*'\/:id\/clarification-response'[\s\S]*?idempotencyMiddleware\(\)/,
  },
];

function main(): void {
  const failures: string[] = [];

  for (const rule of RULES) {
    const absolute = resolve(ROOT, rule.file);
    const content = readFileSync(absolute, 'utf8');
    if (!rule.pattern.test(content)) {
      failures.push(`${rule.file}: ${rule.description}`);
    }
  }

  if (failures.length > 0) {
    console.error(`✗ route idempotency contract failed (${failures.length} missing pattern(s))`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }

  console.log(`✓ Route idempotency contract passed (${RULES.length} checks).`);
}

main();


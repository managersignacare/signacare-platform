/**
 * Guard: enforce intake vs outbound referral split wiring.
 *
 * Invariants:
 * 1) Intake page must query referrals with direction='intake'.
 * 2) Intake create must include explicit receivedDate capture.
 * 3) Referral-out page must query queue with direction='outbound'.
 * 4) Referral-out create must stamp source=OUTBOUND_REFERRAL_SOURCE.
 * 5) Sidebar label for /referrals/queue must be "Referral Out".
 */

import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');

export interface Violation {
  file: string;
  reason: string;
}

function read(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

export function scanSources(params: {
  intakePageSource: string;
  referralOutPageSource: string;
  referralOutCreateSource?: string;
  sidebarSource: string;
}): Violation[] {
  const violations: Violation[] = [];
  const referralOutCreateSource = params.referralOutCreateSource ?? '';
  const referralOutCombinedSource = `${params.referralOutPageSource}\n${referralOutCreateSource}`;

  if (!/direction:\s*'intake'/.test(params.intakePageSource)) {
    violations.push({
      file: 'apps/web/src/features/referrals/pages/ReferralsPage.tsx',
      reason: 'Intake list query must include direction: \'intake\'.',
    });
  }
  if (!/await\s+create\(\s*{[\s\S]*?direction:\s*'intake'/.test(params.intakePageSource)) {
    violations.push({
      file: 'apps/web/src/features/referrals/pages/ReferralsPage.tsx',
      reason: 'Intake create flow must stamp direction as intake.',
    });
  }
  if (!/await\s+create\(\s*{[\s\S]*?receivedDate[\s\S]*?}/.test(params.intakePageSource)) {
    violations.push({
      file: 'apps/web/src/features/referrals/pages/ReferralsPage.tsx',
      reason: 'Intake create flow must pass receivedDate to backend.',
    });
  }
  if (!/label="Received Date"/.test(params.intakePageSource)) {
    violations.push({
      file: 'apps/web/src/features/referrals/pages/ReferralsPage.tsx',
      reason: 'Intake dialog must expose a Received Date field for manual/fax intake.',
    });
  }

  if (!/direction:\s*'outbound'/.test(params.referralOutPageSource)) {
    violations.push({
      file: 'apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx',
      reason: 'Referral-out queue query must include direction: \'outbound\'.',
    });
  }
  if (!/apiClient\.post\('referrals',\s*{[\s\S]*?direction:\s*'outbound'[\s\S]*?source:\s*OUTBOUND_REFERRAL_SOURCE[\s\S]*?}\)/.test(referralOutCombinedSource)) {
    violations.push({
      file: 'apps/web/src/features/referrals/pages/CreateReferralOutDialog.tsx',
      reason: 'Referral-out create flow must stamp direction=outbound and source=OUTBOUND_REFERRAL_SOURCE.',
    });
  }

  if (!/label:\s*'Referral Out'\s*,\s*path:\s*'referrals\/queue'/.test(params.sidebarSource)) {
    violations.push({
      file: 'apps/web/src/shared/components/ui/Sidebar.tsx',
      reason: "Sidebar must label path 'referrals/queue' as 'Referral Out'.",
    });
  }

  return violations;
}

export function runGuard(): { ok: boolean; violations: Violation[] } {
  const violations: Violation[] = [];

  const intakePage = 'apps/web/src/features/referrals/pages/ReferralsPage.tsx';
  const referralOutPage = 'apps/web/src/features/referrals/pages/ReferralCoordinatorQueue.tsx';
  const referralOutCreate = 'apps/web/src/features/referrals/pages/CreateReferralOutDialog.tsx';
  const sidebar = 'apps/web/src/shared/components/ui/Sidebar.tsx';

  violations.push(...scanSources({
    intakePageSource: read(intakePage),
    referralOutPageSource: read(referralOutPage),
    referralOutCreateSource: read(referralOutCreate),
    sidebarSource: read(sidebar),
  }));

  return { ok: violations.length === 0, violations };
}

function main(): number {
  const result = runGuard();
  if (!result.ok) {
    console.error('✗ Referral intake/outbound split guard failed:');
    for (const violation of result.violations) {
      console.error(`  - ${relative(ROOT, resolve(ROOT, violation.file))}: ${violation.reason}`);
    }
    return 1;
  }
  console.log('✓ referral intake/outbound split guard passed.');
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

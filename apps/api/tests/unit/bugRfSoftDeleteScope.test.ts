import fs from 'node:fs';
import path from 'node:path';

const teamStrategySource = fs.readFileSync(
  path.resolve(__dirname, '../../src/features/referrals/strategies/teamStrategy.ts'),
  'utf8',
);

const referralFeedbackServiceSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/features/referrals/referralFeedbackService.ts'),
  'utf8',
);

const referralSlaSchedulerSource = fs.readFileSync(
  path.resolve(__dirname, '../../src/jobs/schedulers/referralSlaScheduler.ts'),
  'utf8',
);

describe('BUG-RF soft-delete scope hardening', () => {
  test('referral feedback staff lookup excludes soft-deleted staff', () => {
    expect(referralFeedbackServiceSource).toMatch(
      /db\('staff'\)\s*\.where\(\{ id: sentByStaffId, clinic_id: clinicId \}\)\s*\.whereNull\('deleted_at'\)/s,
    );
  });

  test('team strategy excludes soft-deleted staff on both acceptance paths', () => {
    const staffQueryMatches = teamStrategySource.match(
      /\.where\(\{ id: userId, clinic_id: clinicId \}\)\s*\.whereNull\('deleted_at'\)/g,
    );
    expect(staffQueryMatches?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  test('team strategy patient name lookup excludes soft-deleted patients', () => {
    expect(teamStrategySource).toMatch(
      /db\('patients'\)\s*\.where\(\{ id: patientId, clinic_id: clinicId \}\)\s*\.whereNull\('deleted_at'\)/s,
    );
  });

  test('referral SLA scheduler patient lookup excludes soft-deleted patients', () => {
    expect(referralSlaSchedulerSource).toMatch(
      /dbAdmin\('patients'\)\s*\.where\(\{ id: patientId, clinic_id: clinicId \}\)\s*\.whereNull\('deleted_at'\)/s,
    );
  });
});

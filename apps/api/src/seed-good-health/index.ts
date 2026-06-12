import { dbAdmin as db, appPoolRaw } from '../db/db';
import { runReferenceDataStep } from './generators/00_reference_data';
import { runClinicsStep } from './generators/01_clinics';
import { runExecutiveStaffStep } from './generators/02_executive_staff';
import { runDepartmentHeadsStep } from './generators/03_department_heads';
import { runClinicStaffStep } from './generators/04_clinic_staff';
import { runMasterLoginStep } from './generators/05_master_login_table';
import { runPatientsStep } from './generators/06_patients';
import { runEpisodesStep } from './generators/07_episodes';
import { runClinicalNotesStep } from './generators/08_clinical_notes';
import { runMedicationsStep } from './generators/09_medications';
import { runPathologyStep } from './generators/10_pathology';
import { runRiskAssessmentsStep } from './generators/11_risk_assessments';
import { runOutcomeMeasuresStep } from './generators/12_outcome_measures';
import { runLegalOrdersStep } from './generators/13_legal_orders';

// Phase 0.8 — Good Health deterministic demo seed entrypoint.
//
// Running contract:
//
//   DEMO_SEED=good-health npm run seed:good-health        # additive, idempotent
//   DEMO_SEED=good-health DEMO_WIPE=1 npm run …           # wipe Good Health only
//
// Refuses to run against NODE_ENV=production unless ALLOW_DEMO_SEED=1
// is set explicitly. Refuses to run against a database whose name is
// not in DB_NAME_ALLOWLIST. Both safeguards are belt-and-braces — the
// plaintext login table the generator writes is fictional and
// deliberately checked into docs/demo/, so the seed must NEVER touch
// a real tenant.
//
// The generator steps themselves ship incrementally across Phase 0.8
// PR1..PR3. This entrypoint file is the stable shape — add new steps to
// the `steps` array as generators land.

const DB_NAME_ALLOWLIST = new Set([
  'signacaredb',
  'signacaredb_test',
  // Azure staging/dev-test database used for Linux deployment smoke tests.
  'signacareemr',
]);

interface SeedStep {
  readonly key: string;
  readonly label: string;
  readonly run: () => Promise<{ inserted: number; updated: number }>;
}

const steps: SeedStep[] = [
  // Generators register themselves here as they land. Order matters —
  // dependencies go before dependents (org before staff before
  // patients before episodes before notes, etc).
  {
    key: '01_clinics',
    label: 'clinics + org_units + org_unit_programs',
    run: () => runClinicsStep(db),
  },
  {
    // Per-tenant reference data (disciplines, clinical roles, referral
    // sources, investigation types, alert types, template categories,
    // appointment modes) + global legal_order_types. Runs BEFORE staff
    // and patients so downstream generators can reference real rows.
    key: '01b_reference_data',
    label: 'reference data (8 AU-curated categories × all active clinics)',
    run: () => runReferenceDataStep(db),
  },
  {
    key: '02_executive_staff',
    label: 'executive + corporate staff (5 personas)',
    run: () => runExecutiveStaffStep(db),
  },
  {
    key: '03_department_heads',
    label: 'department heads (7 HODs + staff_specialties)',
    run: () => runDepartmentHeadsStep(db),
  },
  {
    key: '04_clinic_staff',
    label: 'clinical staff (80 personas across 4 MH clinics × 2 teams)',
    run: () => runClinicStaffStep(db),
  },
  {
    key: '05_master_login_table',
    label: 'master login table → docs/demo/good-health-logins.md',
    run: async () => {
      const r = await runMasterLoginStep();
      return { inserted: r.inserted, updated: r.updated };
    },
  },
  {
    key: '06_patients',
    label: 'patients (80 across 4 MH clinics × 2 teams × 10)',
    run: () => runPatientsStep(db),
  },
  {
    key: '07_episodes',
    label: 'episodes (2 per patient: 1 closed 2021 + 1 open 2024)',
    run: () => runEpisodesStep(db),
  },
  {
    key: '08_clinical_notes',
    label: 'clinical notes (20 per patient × 80 patients = 1600)',
    run: () => runClinicalNotesStep(db),
  },
  {
    key: '09_medications',
    label: 'medications (3 per patient × 80 patients = 240)',
    run: () => runMedicationsStep(db),
  },
  {
    key: '10_pathology',
    label: 'pathology (80 orders + 320 results = 400 rows)',
    run: () => runPathologyStep(db),
  },
  {
    key: '11_risk_assessments',
    label: 'risk assessments (4 per patient × 80 patients = 320)',
    run: () => runRiskAssessmentsStep(db),
  },
  {
    key: '12_outcome_measures',
    label: 'outcome measures (HoNOS + K10 × 4 timepoints × 80 = 640)',
    run: () => runOutcomeMeasuresStep(db),
  },
  {
    key: '13_legal_orders',
    label: 'legal orders (1 TTO lookup + 8 active TTOs across 4 clinics)',
    run: () => runLegalOrdersStep(db),
  },
];

function assertAllowedToRun(): void {
  if (process.env.DEMO_SEED !== 'good-health') {
    throw new Error(
      'Refusing to run: DEMO_SEED=good-health must be set. ' +
        'This is the only way to prove the operator meant to run the demo seed.',
    );
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (nodeEnv === 'production' && process.env.ALLOW_DEMO_SEED !== '1') {
    throw new Error(
      'Refusing to run in NODE_ENV=production without ALLOW_DEMO_SEED=1. ' +
        'The Good Health seed writes fictional PHI-shaped rows and must ' +
        'never land in a real tenant.',
    );
  }

  const dbName = process.env.DB_NAME ?? '';
  if (!DB_NAME_ALLOWLIST.has(dbName)) {
    throw new Error(
      `Refusing to run against DB_NAME='${dbName}'. ` +
        `Only these databases are allowed: ${[...DB_NAME_ALLOWLIST].join(', ')}. ` +
        'If this is a dev clone that should be allowlisted, add it to ' +
        'apps/api/src/seed-good-health/index.ts DB_NAME_ALLOWLIST.',
    );
  }
}

async function main(): Promise<void> {
  assertAllowedToRun();

  const wipe = process.env.DEMO_WIPE === '1';
  const startedAt = new Date();
  console.log(
    `[seed:good-health] started at ${startedAt.toISOString()}` +
      (wipe ? ' (DEMO_WIPE=1)' : ' (additive)'),
  );

  if (steps.length === 0) {
    console.log('[seed:good-health] no generators registered yet — scaffolding only');
    console.log('[seed:good-health] Phase 0.8 PR1..PR3 will register steps here as they land');
    await shutdownPools();
    return;
  }

  let totalInserted = 0;
  let totalUpdated = 0;
  for (const step of steps) {
    const t0 = Date.now();
    const { inserted, updated } = await step.run();
    totalInserted += inserted;
    totalUpdated += updated;
    console.log(
      `[seed:good-health] ${step.key.padEnd(28)} ${inserted.toString().padStart(6)} ins ${updated.toString().padStart(6)} upd (${Date.now() - t0}ms)`,
    );
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  console.log(
    `[seed:good-health] done — ${totalInserted} inserted, ${totalUpdated} updated, ${elapsedMs}ms`,
  );
  await shutdownPools();
}

// Importing '../db/db' constructs three knex pools on module load
// (appPool / dbAdmin / rawDbRead) AND starts a 30-second setInterval
// pool monitor. The setInterval pins the event loop open forever.
// Rather than export + call half a dozen destroy hooks, we finish
// the seed, log the summary, destroy the admin pool we actually
// used, flush stdout, and then process.exit(0). The seed is a
// one-shot CLI task — force-exiting after success is the right
// ergonomic, not a code smell.
async function shutdownPools(): Promise<void> {
  await db.destroy();
  try {
    await appPoolRaw.destroy();
  } catch {
    /* pool may already be closed — ignore */
  }
  await new Promise<void>((resolve) => {
    process.stdout.write('', () => resolve());
  });
  process.exit(0);
}

// Only run when executed directly, not when the module is imported by
// tests or by other seed tooling.
if (require.main === module) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[seed:good-health] FAILED: ${msg}`);
    process.exit(1);
  });
}

export { steps, assertAllowedToRun, DB_NAME_ALLOWLIST };

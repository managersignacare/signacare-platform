/**
 * Minimal e2e test fixtures — creates exactly what the Playwright
 * smoke suite needs to log in and click around:
 *
 *   - TWO clinic rows (PRIMARY + SECONDARY) with stable canonical ids
 *     — SECONDARY enables RLS cross-tenant probes.
 *   - SIX staff users per e2e/fixtures/auth.ts USERS map:
 *       superadmin  → admin@signacare.local            (superadmin)
 *       admin       → tom.obrien@signacare.local       (admin)
 *       manager     → mia.manager@signacare.local      (manager)
 *       receptionist→ riley.reception@signacare.local  (receptionist)
 *       clinician   → sarah.chen@signacare.local       (clinician)
 *       clinician2  → james.wilson@signacare.local     (clinician)
 *     All users belong to the PRIMARY clinic; password is 'Password1!'.
 *   - ONE staff user in the SECONDARY clinic for cross-tenant probes:
 *       other     → other@signacare.local       (clinician)
 *
 * Idempotent via existence-check-then-insert-or-update so re-running
 * against an already-seeded DB is a no-op. Intended to be the
 * Playwright CI job's only seed step — NOT the full demo dataset
 * (which lives in seed-good-health/ and has its own deterministic
 * identity).
 *
 * This module is test-infrastructure: it's not meant to produce a
 * user-facing demo cohort. For that use seed:good-health.
 */
import { dbAdmin, appPoolRaw } from './db/db';
import bcrypt from 'bcryptjs';

const PRIMARY_CLINIC_ID = '11111111-1111-1111-1111-111111111111';
const SECONDARY_CLINIC_ID = '22222222-0000-1111-2222-222222222222';
const A11Y_PATIENT_ID = '77777777-7777-4777-8777-777777777777';
const A11Y_EPISODE_ID = '88888888-8888-4888-8888-888888888888';
const LEGACY_A11Y_PATIENT_ID = '77777777-7777-7777-7777-777777777777';
const LEGACY_A11Y_EPISODE_ID = '88888888-8888-8888-8888-888888888888';
const A11Y_RELATIONSHIP_CLINICIAN_ID = '33333333-3333-3333-3333-333333333333'; // sarah.chen@signacare.local

interface SeedUser {
  id: string;
  email: string;
  givenName: string;
  familyName: string;
  role: 'superadmin' | 'admin' | 'manager' | 'clinician' | 'nurse' | 'psychologist' | 'receptionist';
  discipline: string;
  clinicId: string;
}

const USERS: SeedUser[] = [
  {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'admin@signacare.local',
    givenName: 'E2E',
    familyName: 'Admin',
    role: 'superadmin',
    discipline: 'Administration',
    clinicId: PRIMARY_CLINIC_ID,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'sarah.chen@signacare.local',
    givenName: 'Sarah',
    familyName: 'Chen',
    role: 'clinician',
    discipline: 'Psychiatry',
    clinicId: PRIMARY_CLINIC_ID,
  },
  {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'tom.obrien@signacare.local',
    givenName: 'Tom',
    familyName: "O'Brien",
    role: 'admin',
    discipline: 'Management',
    clinicId: PRIMARY_CLINIC_ID,
  },
  {
    id: '77777777-1111-1111-1111-111111111111',
    email: 'mia.manager@signacare.local',
    givenName: 'Mia',
    familyName: 'Manager',
    role: 'manager',
    discipline: 'Management',
    clinicId: PRIMARY_CLINIC_ID,
  },
  {
    id: '88888888-1111-1111-1111-111111111111',
    email: 'riley.reception@signacare.local',
    givenName: 'Riley',
    familyName: 'Reception',
    role: 'receptionist',
    discipline: 'Reception',
    clinicId: PRIMARY_CLINIC_ID,
  },
  {
    id: '55555555-5555-5555-5555-555555555555',
    email: 'james.wilson@signacare.local',
    givenName: 'James',
    familyName: 'Wilson',
    role: 'clinician',
    discipline: 'Psychology',
    clinicId: PRIMARY_CLINIC_ID,
  },
  {
    id: '66666666-6666-6666-6666-666666666666',
    email: 'other@signacare.local',
    givenName: 'Other',
    familyName: 'Clinic',
    role: 'clinician',
    discipline: 'Psychiatry',
    clinicId: SECONDARY_CLINIC_ID,
  },
];

const DEFAULT_PASSWORD = 'Password1!';

interface SeedReferralSource {
  category: 'internal' | 'external';
  name: string;
  sortOrder: number;
}

const REFERRAL_SOURCES: SeedReferralSource[] = [
  { category: 'internal', name: 'CCT Team', sortOrder: 10 },
  { category: 'external', name: 'General Practitioner', sortOrder: 20 },
  { category: 'external', name: 'Emergency Department', sortOrder: 30 },
];

interface SeedPatient {
  id: string;
  clinicId: string;
  givenName: string;
  familyName: string;
  dateOfBirth: string;
}

interface SeedEpisode {
  id: string;
  clinicId: string;
  patientId: string;
  primaryClinicianId: string;
}

const A11Y_PATIENT: SeedPatient = {
  id: A11Y_PATIENT_ID,
  clinicId: PRIMARY_CLINIC_ID,
  givenName: 'A11y',
  familyName: 'Fixture',
  dateOfBirth: '1990-01-01',
};

const A11Y_EPISODE: SeedEpisode = {
  id: A11Y_EPISODE_ID,
  clinicId: PRIMARY_CLINIC_ID,
  patientId: A11Y_PATIENT_ID,
  primaryClinicianId: A11Y_RELATIONSHIP_CLINICIAN_ID,
};

async function upsertClinic(id: string, name: string, now: Date): Promise<void> {
  const existing = await dbAdmin('clinics').where({ id }).first();
  if (existing) {
    await dbAdmin('clinics').where({ id }).update({
      name, legal_name: `${name} Pty Ltd`, abn: '11 000 000 000',
      time_zone: 'Australia/Melbourne', is_active: true, updated_at: now,
    });
    console.log(`[seed-e2e] clinic ${id} updated`);
  } else {
    await dbAdmin('clinics').insert({
      id, name, legal_name: `${name} Pty Ltd`, abn: '11 000 000 000',
      time_zone: 'Australia/Melbourne', is_active: true,
      created_at: now, updated_at: now,
    });
    console.log(`[seed-e2e] clinic ${id} inserted`);
  }
}

async function upsertUser(u: SeedUser, passwordHash: string, now: Date): Promise<void> {
  const existing = await dbAdmin('staff').where({ id: u.id }).first();
  if (existing) {
    await dbAdmin('staff').where({ id: u.id }).update({
      clinic_id: u.clinicId,
      given_name: u.givenName,
      family_name: u.familyName,
      email: u.email,
      password_hash: passwordHash,
      role: u.role,
      discipline: u.discipline,
      is_active: true,
      require_mfa: false,
      has_mfa_configured: false,
      failed_login_attempts: 0,
      updated_at: now,
    });
    console.log(`[seed-e2e] staff ${u.email} updated`);
  } else {
    await dbAdmin('staff').insert({
      id: u.id,
      clinic_id: u.clinicId,
      given_name: u.givenName,
      family_name: u.familyName,
      email: u.email,
      password_hash: passwordHash,
      role: u.role,
      discipline: u.discipline,
      is_active: true,
      require_mfa: false,
      has_mfa_configured: false,
      failed_login_attempts: 0,
      created_at: now,
      updated_at: now,
    });
    console.log(`[seed-e2e] staff ${u.email} inserted`);
  }
}

async function upsertReferralSource(
  clinicId: string,
  source: SeedReferralSource,
  now: Date,
): Promise<void> {
  const existing = await dbAdmin('referral_sources')
    .where({
      clinic_id: clinicId,
      category: source.category,
      name: source.name,
    })
    .first();

  if (existing) {
    await dbAdmin('referral_sources')
      .where({ id: existing.id })
      .update({
        is_active: true,
        sort_order: source.sortOrder,
        updated_at: now,
      });
    console.log(`[seed-e2e] referral source ${source.category}/${source.name} updated`);
    return;
  }

  await dbAdmin('referral_sources').insert({
    clinic_id: clinicId,
    category: source.category,
    name: source.name,
    is_active: true,
    sort_order: source.sortOrder,
    created_at: now,
    updated_at: now,
  });
  console.log(`[seed-e2e] referral source ${source.category}/${source.name} inserted`);
}

async function upsertPatient(patient: SeedPatient, now: Date): Promise<void> {
  const existing = await dbAdmin('patients').where({ id: patient.id }).first();
  if (existing) {
    await dbAdmin('patients').where({ id: patient.id }).update({
      clinic_id: patient.clinicId,
      given_name: patient.givenName,
      family_name: patient.familyName,
      date_of_birth: patient.dateOfBirth,
      status: 'active',
      consent_to_treatment: true,
      updated_at: now,
      deleted_at: null,
    });
    console.log(`[seed-e2e] patient ${patient.familyName}, ${patient.givenName} updated`);
    return;
  }

  await dbAdmin('patients').insert({
    id: patient.id,
    clinic_id: patient.clinicId,
    given_name: patient.givenName,
    family_name: patient.familyName,
    date_of_birth: patient.dateOfBirth,
    status: 'active',
    consent_to_treatment: true,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  });
  console.log(`[seed-e2e] patient ${patient.familyName}, ${patient.givenName} inserted`);
}

async function upsertEpisode(episode: SeedEpisode, now: Date): Promise<void> {
  const existing = await dbAdmin('episodes').where({ id: episode.id }).first();
  const basePatch = {
    clinic_id: episode.clinicId,
    patient_id: episode.patientId,
    title: 'E2E accessibility relationship fixture',
    episode_type: 'inpatient',
    status: 'open',
    start_date: now.toISOString().slice(0, 10),
    specialty_code: 'mental_health',
    primary_clinician_id: episode.primaryClinicianId,
    // BUG-C2-fixture-lock-version: EpisodeResponseSchema requires a
    // positive lockVersion when present. Seeding 0 made
    // GET /episodes/patient/:id fail with 422 in UI probes.
    lock_version: 1,
    deleted_at: null,
    updated_at: now,
  };

  if (existing) {
    await dbAdmin('episodes').where({ id: episode.id }).update(basePatch);
    console.log('[seed-e2e] accessibility episode fixture updated');
    return;
  }

  await dbAdmin('episodes').insert({
    id: episode.id,
    ...basePatch,
    created_at: now,
  });
  console.log('[seed-e2e] accessibility episode fixture inserted');
}

async function cleanupLegacyA11yFixtures(): Promise<void> {
  // Legacy fixture ids used UUID variants that violate RFC-4122
  // version/variant bits. Keep seed runs deterministic by removing
  // those stale rows before writing the canonical v4-compatible ids.
  const deletedEpisodes = await dbAdmin('episodes')
    .where({ id: LEGACY_A11Y_EPISODE_ID })
    .orWhere({ patient_id: LEGACY_A11Y_PATIENT_ID })
    .delete();
  const deletedPatients = await dbAdmin('patients')
    .where({ id: LEGACY_A11Y_PATIENT_ID })
    .delete();

  if (deletedEpisodes > 0 || deletedPatients > 0) {
    console.log(
      `[seed-e2e] removed legacy a11y fixtures (episodes=${deletedEpisodes}, patients=${deletedPatients})`,
    );
  }
}

async function seedE2EFixtures(): Promise<void> {
  const now = new Date();
  await upsertClinic(PRIMARY_CLINIC_ID, 'E2E Test Clinic', now);
  await upsertClinic(SECONDARY_CLINIC_ID, 'E2E Secondary Clinic', now);

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
  for (const u of USERS) {
    await upsertUser(u, passwordHash, now);
  }

  for (const source of REFERRAL_SOURCES) {
    await upsertReferralSource(PRIMARY_CLINIC_ID, source, now);
  }

  await cleanupLegacyA11yFixtures();
  await upsertPatient(A11Y_PATIENT, now);
  await upsertEpisode(A11Y_EPISODE, now);

  const primaryUserCount = USERS.filter((u) => u.clinicId === PRIMARY_CLINIC_ID).length;
  const secondaryUserCount = USERS.filter((u) => u.clinicId === SECONDARY_CLINIC_ID).length;
  console.log(
    `[seed-e2e] done — ${primaryUserCount} primary-clinic users + ${secondaryUserCount} secondary-clinic probe user, ` +
      '1 accessibility patient fixture, across 2 clinics. password Password1!',
  );
}

async function main(): Promise<void> {
  try {
    await seedE2EFixtures();
  } finally {
    // Mirror the shutdown pattern from seed-good-health/index.ts —
    // destroy both pools + force process.exit so the db/db.ts
    // module-level setInterval pool monitor doesn't pin the event
    // loop open after main() returns.
    await dbAdmin.destroy().catch(() => undefined);
    await appPoolRaw.destroy().catch(() => undefined);
    await new Promise<void>((resolve) => {
      process.stdout.write('', () => resolve());
    });
    process.exit(0);
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[seed-e2e] FAILED: ${msg}`);
    process.exit(1);
  });
}

export { seedE2EFixtures, PRIMARY_CLINIC_ID, SECONDARY_CLINIC_ID, USERS, DEFAULT_PASSWORD };

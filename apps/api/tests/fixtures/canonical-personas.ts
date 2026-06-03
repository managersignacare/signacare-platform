import bcrypt from 'bcryptjs';
import { appPoolRaw, dbAdmin } from '../../src/db/db';
import { ensureCanonicalSpecialties } from '../../src/shared/ensureCanonicalSpecialties';
import { withTenantContext } from '../../src/shared/tenantContext';

export const CANONICAL_PASSWORD = 'Password1!';

export const CANONICAL_CLINIC_IDS = {
  primary: '11111111-1111-1111-1111-111111111111',
  secondary: '22222222-0000-1111-2222-222222222222',
} as const;

type CanonicalRole =
  | 'superadmin'
  | 'admin'
  | 'clinician'
  | 'manager'
  | 'receptionist'
  | 'readonly'
  | 'referral_coordinator';

interface CanonicalPersona {
  id: string;
  email: string;
  givenName: string;
  familyName: string;
  role: CanonicalRole;
  discipline: string;
  clinicId: string;
}

interface CanonicalPatientFixture {
  id: string;
  clinicId: string;
  givenName: string;
  familyName: string;
  emrNumber: string;
  dateOfBirth: string;
}

export const CANONICAL_PERSONAS = {
  superadmin: {
    id: '22222222-2222-2222-2222-222222222222',
    email: 'admin@signacare.local',
    givenName: 'E2E',
    familyName: 'Admin',
    role: 'superadmin',
    discipline: 'Administration',
    clinicId: CANONICAL_CLINIC_IDS.primary,
  },
  clinician: {
    id: '33333333-3333-3333-3333-333333333333',
    email: 'sarah.chen@signacare.local',
    givenName: 'Sarah',
    familyName: 'Chen',
    role: 'clinician',
    discipline: 'Psychiatry',
    clinicId: CANONICAL_CLINIC_IDS.primary,
  },
  admin: {
    id: '44444444-4444-4444-4444-444444444444',
    email: 'tom.obrien@signacare.local',
    givenName: 'Tom',
    familyName: "O'Brien",
    role: 'admin',
    discipline: 'Management',
    clinicId: CANONICAL_CLINIC_IDS.primary,
  },
  clinician2: {
    id: '55555555-5555-5555-5555-555555555555',
    email: 'james.wilson@signacare.local',
    givenName: 'James',
    familyName: 'Wilson',
    role: 'clinician',
    discipline: 'Psychology',
    clinicId: CANONICAL_CLINIC_IDS.primary,
  },
  otherClinicClinician: {
    id: '66666666-6666-6666-6666-666666666666',
    email: 'other@signacare.local',
    givenName: 'Other',
    familyName: 'Clinic',
    role: 'clinician',
    discipline: 'Psychiatry',
    clinicId: CANONICAL_CLINIC_IDS.secondary,
  },
  manager: {
    id: '77777777-7777-7777-7777-777777777777',
    email: 'manager@signacare.local',
    givenName: 'Maya',
    familyName: 'Manager',
    role: 'manager',
    discipline: 'Operations',
    clinicId: CANONICAL_CLINIC_IDS.primary,
  },
  receptionist: {
    id: '88888888-8888-8888-8888-888888888888',
    email: 'reception@signacare.local',
    givenName: 'Rita',
    familyName: 'Reception',
    role: 'receptionist',
    discipline: 'Reception',
    clinicId: CANONICAL_CLINIC_IDS.primary,
  },
  referralCoordinator: {
    id: '99999999-9999-9999-9999-999999999999',
    email: 'referrals@signacare.local',
    givenName: 'Reed',
    familyName: 'Referrals',
    role: 'referral_coordinator',
    discipline: 'Referral Coordination',
    clinicId: CANONICAL_CLINIC_IDS.primary,
  },
  readonly: {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    email: 'readonly@signacare.local',
    givenName: 'Robin',
    familyName: 'Readonly',
    role: 'readonly',
    discipline: 'Audit',
    clinicId: CANONICAL_CLINIC_IDS.primary,
  },
} as const satisfies Record<string, CanonicalPersona>;

const CANONICAL_PATIENT_FIXTURES: readonly CanonicalPatientFixture[] = [
  {
    id: 'b1111111-1111-4111-8111-111111111111',
    clinicId: CANONICAL_CLINIC_IDS.primary,
    givenName: 'Noah',
    familyName: 'Bennett',
    emrNumber: 'CAN-PRIMARY-001',
    dateOfBirth: '1990-01-01',
  },
  {
    id: 'b2222222-2222-4222-8222-222222222222',
    clinicId: CANONICAL_CLINIC_IDS.primary,
    givenName: 'Olivia',
    familyName: 'Harper',
    emrNumber: 'CAN-PRIMARY-002',
    dateOfBirth: '1992-02-02',
  },
  {
    id: 'b3333333-3333-4333-8333-333333333333',
    clinicId: CANONICAL_CLINIC_IDS.secondary,
    givenName: 'Mason',
    familyName: 'Khan',
    emrNumber: 'CAN-SECONDARY-001',
    dateOfBirth: '1994-03-03',
  },
] as const;

async function upsertClinic(id: string, name: string, hpio: string, now: Date): Promise<void> {
  const existing = await dbAdmin('clinics').where({ id }).first();
  const payload = {
    name,
    legal_name: `${name} Pty Ltd`,
    abn: '11 000 000 000',
    hpio,
    timezone: 'Australia/Melbourne',
    time_zone: 'Australia/Melbourne',
    is_active: true,
    deleted_at: null,
    updated_at: now,
  };

  if (existing) {
    await dbAdmin('clinics').where({ id }).update(payload);
    return;
  }

  await dbAdmin('clinics').insert({
    id,
    ...payload,
    created_at: now,
  });
}

async function upsertPersona(persona: CanonicalPersona, passwordHash: string, now: Date): Promise<void> {
  await withTenantContext(persona.clinicId, async () => {
    const existing = await dbAdmin('staff').where({ id: persona.id }).first();
    const payload = {
      clinic_id: persona.clinicId,
      given_name: persona.givenName,
      family_name: persona.familyName,
      email: persona.email,
      password_hash: passwordHash,
      role: persona.role,
      discipline: persona.discipline,
      is_active: true,
      require_mfa: false,
      has_mfa_configured: false,
      failed_login_attempts: 0,
      locked_until: null,
      must_change_password: false,
      deleted_at: null,
      updated_at: now,
    };

    if (existing) {
      await dbAdmin('staff').where({ id: persona.id }).update(payload);
      return;
    }

    await dbAdmin('staff').insert({
      id: persona.id,
      ...payload,
      created_at: now,
    });
  });
}

async function upsertPatient(patient: CanonicalPatientFixture, now: Date): Promise<void> {
  await withTenantContext(patient.clinicId, async () => {
    const existing = await dbAdmin('patients').where({ id: patient.id }).first();
    const payload = {
      clinic_id: patient.clinicId,
      given_name: patient.givenName,
      family_name: patient.familyName,
      emr_number: patient.emrNumber,
      date_of_birth: patient.dateOfBirth,
      status: 'active',
      updated_at: now,
    };
    if (existing) {
      await dbAdmin('patients').where({ id: patient.id }).update(payload);
      return;
    }
    await dbAdmin('patients').insert({
      id: patient.id,
      ...payload,
      created_at: now,
    });
  });
}

export async function seedCanonicalPersonas(): Promise<void> {
  const now = new Date();
  await ensureCanonicalSpecialties({ force: true, caller: 'tests.seedCanonicalPersonas' });
  await upsertClinic(CANONICAL_CLINIC_IDS.primary, 'Canonical Primary Clinic', '8003621234567892', now);
  await upsertClinic(CANONICAL_CLINIC_IDS.secondary, 'Canonical Secondary Clinic', '8003621234567893', now);

  const passwordHash = await bcrypt.hash(CANONICAL_PASSWORD, 10);
  for (const persona of Object.values(CANONICAL_PERSONAS)) {
    await upsertPersona(persona, passwordHash, now);
  }
  for (const patient of CANONICAL_PATIENT_FIXTURES) {
    await upsertPatient(patient, now);
  }
}

async function main(): Promise<void> {
  try {
    await seedCanonicalPersonas();
    console.log(
      `[seed-canonical-personas] done — ${Object.keys(CANONICAL_PERSONAS).length} personas upserted`,
    );
  } finally {
    await dbAdmin.destroy().catch(() => undefined);
    await appPoolRaw.destroy().catch(() => undefined);
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[seed-canonical-personas] FAILED: ${msg}`);
    process.exit(1);
  });
}

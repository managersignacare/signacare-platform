import 'dotenv/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import type { AuthContext, CreatePatientDTO } from '@signacare/shared';
import { appPoolRaw, clearPoolMonitor, db, dbAdmin, rlsStore } from '../src/db/db';
import { patientService } from '../src/features/patients/patientService';
import { luhnCheck } from '../src/shared/hiNumbers';

interface ClinicRow {
  id: string;
  name: string;
}

interface StaffActorRow {
  id: string;
}

interface DemoPerson {
  givenName: string;
  familyName: string;
}

interface DemoContact {
  contactType: string;
  givenName: string;
  familyName: string;
  relationship: string;
  phoneMobile: string;
  phoneHome: string;
  email: string;
  isEmergencyContact: boolean;
  isCarer: boolean;
  hasConsent: boolean;
  consentLevel: 'emergency_only' | 'partial' | 'full';
  consentNotes: string;
}

interface DemoProvider {
  providerType: string;
  providerName: string;
  providerPractice: string;
  providerPhone: string;
  providerFax: string;
  providerEmail: string;
  providerNumber: string;
  providerAddress: string;
  isPrimary: boolean;
}

interface DemoPatientRegistration {
  patient: CreatePatientDTO;
  contacts: DemoContact[];
  providers: DemoProvider[];
}

interface SeedSummaryRow {
  patientId: string;
  patientName: string;
  patientEmail: string;
  dateOfBirth: string;
  gpName: string;
  supportPeople: string;
}

interface ExistingPatientIdentityRow {
  id: string;
  medicare_number?: string | null;
  medicare_reference?: string | null;
  medicare_expiry?: string | null;
  ihi_number?: string | null;
  dva_number?: string | null;
  dva_card_type?: string | null;
}

const CLINIC_NAME = process.env.DEMO_PATIENT_CLINIC_NAME ?? 'Soham Health';
const EMAIL_DOMAIN = 'demo.local';

const PATIENT_NAME_POOL: readonly DemoPerson[] = [
  { givenName: 'Amelia', familyName: 'Dawson' },
  { givenName: 'Noah', familyName: 'Bennett' },
  { givenName: 'Priya', familyName: 'Menon' },
  { givenName: 'Thomas', familyName: 'Nguyen' },
  { givenName: 'Zara', familyName: 'Coleman' },
  { givenName: 'Ethan', familyName: 'Patel' },
  { givenName: 'Leila', familyName: 'Hassan' },
  { givenName: 'Marcus', familyName: 'Donovan' },
  { givenName: 'Hannah', familyName: 'Reid' },
  { givenName: 'Victor', familyName: 'Lam' },
  { givenName: 'Sienna', familyName: 'Wallace' },
  { givenName: 'Jordan', familyName: 'Ali' },
  { givenName: 'Maya', familyName: 'Bishop' },
  { givenName: 'Oliver', familyName: 'Khan' },
  { givenName: 'Talia', familyName: 'Morgan' },
  { givenName: 'Isaac', familyName: 'Chen' },
  { givenName: 'Ava', familyName: 'Douglas' },
  { givenName: 'Leo', familyName: 'Sharma' },
  { givenName: 'Freya', familyName: 'Olsen' },
  { givenName: 'Caleb', familyName: 'Singh' },
  { givenName: 'Nora', familyName: 'Parker' },
  { givenName: 'Samuel', familyName: 'Hughes' },
  { givenName: 'Elena', familyName: 'Rao' },
  { givenName: 'Mason', familyName: 'Brooks' },
  { givenName: 'Ruby', familyName: 'Fisher' },
  { givenName: 'Julian', familyName: 'Stone' },
  { givenName: 'Imogen', familyName: 'Price' },
  { givenName: 'Nathan', familyName: 'Ward' },
  { givenName: 'Zoe', familyName: 'Patel' },
  { givenName: 'Hamish', familyName: 'Grant' },
];

const SUPPORT_NAME_POOL: readonly DemoPerson[] = [
  { givenName: 'Olivia', familyName: 'Dawson' },
  { givenName: 'Liam', familyName: 'Dawson' },
  { givenName: 'Grace', familyName: 'Bennett' },
  { givenName: 'Jack', familyName: 'Bennett' },
  { givenName: 'Asha', familyName: 'Menon' },
  { givenName: 'Rohan', familyName: 'Menon' },
  { givenName: 'Mia', familyName: 'Nguyen' },
  { givenName: 'Daniel', familyName: 'Nguyen' },
  { givenName: 'Charlotte', familyName: 'Coleman' },
  { givenName: 'Henry', familyName: 'Coleman' },
  { givenName: 'Sophie', familyName: 'Patel' },
  { givenName: 'Arjun', familyName: 'Patel' },
];

const GP_NAME_POOL: readonly DemoPerson[] = [
  { givenName: 'Harriet', familyName: 'Collins' },
  { givenName: 'Benjamin', familyName: 'Reid' },
  { givenName: 'Natalie', familyName: 'Ford' },
  { givenName: 'Samuel', familyName: 'Cheung' },
  { givenName: 'Eliza', familyName: 'Brown' },
  { givenName: 'Kieran', familyName: 'Singh' },
];

const PSYCHIATRIST_NAME_POOL: readonly DemoPerson[] = [
  { givenName: 'Marcus', familyName: 'Leung' },
  { givenName: 'Anika', familyName: 'Rao' },
  { givenName: 'Julian', familyName: 'Bishop' },
  { givenName: 'Nora', familyName: 'Connelly' },
  { givenName: 'Mitchell', familyName: 'Santos' },
  { givenName: 'Tara', familyName: 'Vella' },
];

const ADDRESS_POOL = [
  { street: '14 Collins Street', suburb: 'Melbourne', state: 'VIC', postcode: '3000' },
  { street: '8 Queen Street', suburb: 'Brisbane City', state: 'QLD', postcode: '4000' },
  { street: '122 King William Street', suburb: 'Adelaide', state: 'SA', postcode: '5000' },
  { street: '26 Murray Street', suburb: 'Hobart', state: 'TAS', postcode: '7000' },
  { street: '91 St Georges Terrace', suburb: 'Perth', state: 'WA', postcode: '6000' },
  { street: '44 Northbourne Avenue', suburb: 'Canberra', state: 'ACT', postcode: '2601' },
] as const;

const HEALTH_FUNDS = [
  { name: 'Bupa', prefix: 'BUPA' },
  { name: 'Medibank', prefix: 'MEDI' },
  { name: 'HCF', prefix: 'HCF' },
  { name: 'nib', prefix: 'NIB' },
  { name: 'AHM', prefix: 'AHM' },
  { name: 'Teachers Health', prefix: 'TH' },
] as const;

const RELATIONSHIPS = ['Parent', 'Spouse', 'Sibling', 'Guardian', 'Partner', 'Friend'] as const;
const GENDERS = ['female', 'male', 'female', 'male', 'female', 'male'] as const;
const PRONOUNS = ['she/her', 'he/him', 'she/her', 'he/him', 'she/her', 'he/him'] as const;
const ATSI_STATUSES = [
  'Neither Aboriginal nor Torres Strait Islander',
  'Not Stated',
  'Neither Aboriginal nor Torres Strait Islander',
  'Not Stated',
  'Aboriginal',
  'Torres Strait Islander',
] as const;
const INTERPRETER_LANGUAGES = ['Hindi', 'Vietnamese', 'Arabic', 'Mandarin', 'Greek', 'Punjabi'] as const;

function toEmailToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '');
}

function buildEmail(givenName: string, familyName: string): string {
  return `${toEmailToken(givenName)}.${toEmailToken(familyName)}@${EMAIL_DOMAIN}`;
}

function fullName(person: DemoPerson): string {
  return `${person.givenName} ${person.familyName}`;
}

function pickCycled<T>(items: readonly T[], index: number): T {
  const next = items[index % items.length];
  if (next === undefined) {
    throw new Error('Expected non-empty seed source array');
  }
  return next;
}

function fixLuhn(fifteenDigits: string): string {
  for (let checkDigit = 0; checkDigit < 10; checkDigit += 1) {
    const candidate = `${fifteenDigits}${checkDigit}`;
    if (luhnCheck(candidate)) return candidate;
  }
  throw new Error(`Unable to generate valid IHI for seed body ${fifteenDigits}`);
}

function buildIhi(index: number): string {
  const seedBody = String(index + 1).padStart(9, '0');
  return fixLuhn(`800360${seedBody}`);
}

function buildPhone(prefix: string, index: number): string {
  return `${prefix}${String(index + 1).padStart(8, '0')}`;
}

function buildDemoPatients(): DemoPatientRegistration[] {
  return PATIENT_NAME_POOL.map((person, index) => {
    const gp = pickCycled(GP_NAME_POOL, index);
    const psychiatrist = pickCycled(PSYCHIATRIST_NAME_POOL, index);
    const supportPrimary = pickCycled(SUPPORT_NAME_POOL, index * 2);
    const supportSecondary = pickCycled(SUPPORT_NAME_POOL, index * 2 + 1);
    const address = pickCycled(ADDRESS_POOL, index);
    const fund = pickCycled(HEALTH_FUNDS, index);
    const relationship = pickCycled(RELATIONSHIPS, index);
    const birthYear = 1980 + index;
    const dateOfBirth = `${birthYear}-${String((index % 12) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`;
    const gpProviderNumber = `GP${String(700000 + index).padStart(6, '0')}`;
    const specialistProviderNumber = `SP${String(810000 + index).padStart(6, '0')}`;
    const interpreterRequired = index % 2 === 0;
    const consentToShareWithCarer = index % 2 === 0;
    const patientEmail = buildEmail(person.givenName, person.familyName);

    const patient: CreatePatientDTO = {
      givenName: person.givenName,
      familyName: person.familyName,
      preferredName: person.givenName,
      dateOfBirth,
      gender: pickCycled(GENDERS, index),
      pronouns: pickCycled(PRONOUNS, index),
      medicareNumber: `2${String(123456789 + index).padStart(9, '0')}`,
      medicareIrn: `${(index % 9) + 1}`,
      medicareExpiry: `12/203${index % 10}`,
      ihi: buildIhi(index),
      dvaNumber: `DVA${String(900000 + index).padStart(6, '0')}`,
      dvaCardType: index % 3 === 0 ? 'gold' : index % 3 === 1 ? 'white' : 'orange',
      phoneMobile: buildPhone('04', index),
      phoneHome: buildPhone('03', index),
      emailPrimary: patientEmail,
      addressStreet: address.street,
      addressSuburb: address.suburb,
      addressState: address.state,
      addressPostcode: address.postcode,
      healthFundName: fund.name,
      healthFundNumber: `${fund.prefix}${String(44000 + index)}`,
      gpName: fullName(gp),
      gpPractice: `${address.suburb} Family Practice`,
      gpPhone: buildPhone('03', index + 20),
      gpFax: buildPhone('03', index + 40),
      gpEmail: buildEmail(gp.givenName, gp.familyName),
      gpProviderNumber,
      gpAddressStreet: `${10 + index} Market Street`,
      gpAddressSuburb: address.suburb,
      gpAddressState: address.state,
      gpAddressPostcode: address.postcode,
      nokName: fullName(supportPrimary),
      nokRelationship: relationship,
      nokPhone: buildPhone('04', index + 60),
      atsiStatus: pickCycled(ATSI_STATUSES, index),
      interpreterRequired,
      interpreterLanguage: interpreterRequired ? pickCycled(INTERPRETER_LANGUAGES, index) : undefined,
      consentToTreatment: true,
      consentForResearch: index % 2 === 0,
      consentToShareWithGp: true,
      consentToShareWithCarer,
      status: 'active',
    };

    const contacts: DemoContact[] = [
      {
        contactType: 'support_person',
        givenName: supportPrimary.givenName,
        familyName: supportPrimary.familyName,
        relationship,
        phoneMobile: buildPhone('04', index + 80),
        phoneHome: buildPhone('03', index + 80),
        email: buildEmail(supportPrimary.givenName, supportPrimary.familyName),
        isEmergencyContact: true,
        isCarer: true,
        hasConsent: true,
        consentLevel: 'full',
        consentNotes: 'Primary support contact for treatment updates and emergencies.',
      },
      {
        contactType: 'support_person',
        givenName: supportSecondary.givenName,
        familyName: supportSecondary.familyName,
        relationship: 'Friend',
        phoneMobile: buildPhone('04', index + 100),
        phoneHome: buildPhone('03', index + 100),
        email: buildEmail(supportSecondary.givenName, supportSecondary.familyName),
        isEmergencyContact: false,
        isCarer: false,
        hasConsent: true,
        consentLevel: 'partial',
        consentNotes: 'Can receive appointment reminders and practical-care coordination updates.',
      },
    ];

    const providers: DemoProvider[] = [
      {
        providerType: 'General Practitioner',
        providerName: fullName(gp),
        providerPractice: `${address.suburb} Family Practice`,
        providerPhone: buildPhone('03', index + 120),
        providerFax: buildPhone('03', index + 140),
        providerEmail: buildEmail(gp.givenName, gp.familyName),
        providerNumber: gpProviderNumber,
        providerAddress: `${10 + index} Market Street, ${address.suburb}, ${address.state} ${address.postcode}`,
        isPrimary: true,
      },
      {
        providerType: 'Psychiatrist',
        providerName: fullName(psychiatrist),
        providerPractice: `${address.suburb} Specialist Mental Health Centre`,
        providerPhone: buildPhone('03', index + 160),
        providerFax: buildPhone('03', index + 180),
        providerEmail: buildEmail(psychiatrist.givenName, psychiatrist.familyName),
        providerNumber: specialistProviderNumber,
        providerAddress: `${30 + index} Health Avenue, ${address.suburb}, ${address.state} ${address.postcode}`,
        isPrimary: false,
      },
    ];

    return { patient, contacts, providers };
  });
}

async function runInClinicRlsContext<T>(clinicId: string, work: () => Promise<T>): Promise<T> {
  return appPoolRaw.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    await trx.raw("SELECT set_config('app.user_id', ?, true)", [randomUUID()]);
    return new Promise<T>((resolve, reject) => {
      rlsStore.run(trx, () => {
        work().then(resolve).catch(reject);
      });
    });
  });
}

async function resolveSeedClinic(): Promise<ClinicRow> {
  const clinic = (await dbAdmin('clinics')
    .where({ name: CLINIC_NAME, is_active: true })
    .whereNull('deleted_at')
    .first('id', 'name')) as ClinicRow | undefined;

  if (!clinic) {
    throw new Error(`Clinic "${CLINIC_NAME}" not found. Set DEMO_PATIENT_CLINIC_NAME if needed.`);
  }
  return clinic;
}

async function resolveActorStaffId(clinicId: string): Promise<string> {
  const actor =
    ((await dbAdmin('staff')
      .where({ clinic_id: clinicId, role: 'admin', is_active: true })
      .whereNull('deleted_at')
      .first('id')) as StaffActorRow | undefined) ??
    ((await dbAdmin('staff')
      .where({ clinic_id: clinicId, is_active: true })
      .whereNull('deleted_at')
      .first('id')) as StaffActorRow | undefined);

  if (!actor?.id) {
    throw new Error(`No active staff found in clinic ${clinicId} to attribute patient-audit writes.`);
  }
  return actor.id;
}

async function upsertDemoPatient(
  clinicId: string,
  auth: AuthContext,
  registration: DemoPatientRegistration,
): Promise<SeedSummaryRow> {
  const patientEmail = registration.patient.emailPrimary?.toLowerCase();
  const existing = await db('patients')
    .where({
      clinic_id: clinicId,
      given_name: registration.patient.givenName,
      family_name: registration.patient.familyName,
      date_of_birth: registration.patient.dateOfBirth,
    })
    .whereNull('deleted_at')
    .first<ExistingPatientIdentityRow>(
      'id',
      'medicare_number',
      'medicare_reference',
      'medicare_expiry',
      'ihi_number',
      'dva_number',
      'dva_card_type',
    );

  const createPayload: CreatePatientDTO = registration.patient;
  // Gold-standard seed idempotency: if the patient row already exists,
  // keep identity fields unchanged and only refresh related demo artifacts.
  const patientId = existing?.id
    ? String(existing.id)
    : (await patientService.create(auth, createPayload)).id;
  const now = new Date();

  await db('patient_contacts')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .del();
  await db('patient_providers')
    .where({ clinic_id: clinicId, patient_id: patientId })
    .del();

  if (registration.contacts.length > 0) {
    await db('patient_contacts').insert(
      registration.contacts.map((contact) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        contact_type: contact.contactType,
        given_name: contact.givenName,
        family_name: contact.familyName,
        relationship: contact.relationship,
        phone_mobile: contact.phoneMobile,
        phone_home: contact.phoneHome,
        email: contact.email.toLowerCase(),
        is_emergency_contact: contact.isEmergencyContact,
        is_carer: contact.isCarer,
        has_consent: contact.hasConsent,
        consent_level: contact.consentLevel,
        consent_notes: contact.consentNotes,
        created_at: now,
        updated_at: now,
      })),
    );
  }

  if (registration.providers.length > 0) {
    await db('patient_providers').insert(
      registration.providers.map((provider) => ({
        id: randomUUID(),
        clinic_id: clinicId,
        patient_id: patientId,
        provider_type: provider.providerType,
        provider_name: provider.providerName,
        provider_practice: provider.providerPractice,
        provider_phone: provider.providerPhone,
        provider_fax: provider.providerFax,
        provider_email: provider.providerEmail.toLowerCase(),
        provider_number: provider.providerNumber,
        provider_address: provider.providerAddress,
        is_primary: provider.isPrimary,
        created_at: now,
        updated_at: now,
      })),
    );
  }

  return {
    patientId,
    patientName: `${registration.patient.givenName} ${registration.patient.familyName}`,
    patientEmail: patientEmail ?? '',
    dateOfBirth: registration.patient.dateOfBirth,
    gpName: registration.patient.gpName ?? '',
    supportPeople: registration.contacts.map((c) => `${c.givenName} ${c.familyName}`).join(', '),
  };
}

async function writeSummary(clinicName: string, rows: SeedSummaryRow[]): Promise<string> {
  const outDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'demo');
  const outPath = path.join(outDir, 'soham-mh-patient-registration-demo.md');
  await mkdir(outDir, { recursive: true });

  const lines: string[] = [
    '# Soham Health Demo Patients (Full Registration)',
    '',
    '> Demo-only patients seeded with full registration fields, support persons, and external providers.',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Clinic: ${clinicName}`,
    `Patient count: ${rows.length}`,
    '',
    '| Patient | Email | DOB | GP | Support Persons |',
    '|---|---|---|---|---|',
  ];

  for (const row of rows) {
    lines.push(`| ${row.patientName} | ${row.patientEmail} | ${row.dateOfBirth} | ${row.gpName} | ${row.supportPeople} |`);
  }
  lines.push('');

  await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');
  return outPath;
}

async function seed(): Promise<void> {
  const clinic = await resolveSeedClinic();
  const actorStaffId = await resolveActorStaffId(clinic.id);

  const auth: AuthContext = {
    staffId: actorStaffId,
    clinicId: clinic.id,
    role: 'admin',
    permissions: [],
  };

  const registrations = buildDemoPatients();
  const results = await runInClinicRlsContext(clinic.id, async () => {
    const seededRows: SeedSummaryRow[] = [];
    for (const registration of registrations) {
      const seeded = await upsertDemoPatient(clinic.id, auth, registration);
      seededRows.push(seeded);
    }
    return seededRows;
  });

  const outputPath = await writeSummary(clinic.name, results);
  console.log(
    JSON.stringify(
      {
        clinic: clinic.name,
        seededPatients: results.length,
        output: outputPath,
      },
      null,
      2,
    ),
  );
}

seed()
  .then(async () => {
    clearPoolMonitor();
    await dbAdmin.destroy();
    await appPoolRaw.destroy();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    clearPoolMonitor();
    await dbAdmin.destroy();
    await appPoolRaw.destroy();
    process.exit(1);
  });

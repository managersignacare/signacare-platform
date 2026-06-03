import 'dotenv/config';
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import type { AuthContext } from '@signacare/shared';
import { appPoolRaw, clearPoolMonitor, dbAdmin, rlsStore } from '../src/db/db';
import { StaffRepository } from '../src/features/staff/staffRepository';
import { StaffService } from '../src/features/staff/staffService';

interface ClinicRow {
  id: string;
  name: string;
}

interface OrgUnitRow {
  id: string;
  name: string;
}

interface DisciplineRow {
  id: string;
  name: string;
}

interface StaffSeedTemplate {
  templateId: string;
  title: string;
  role: 'admin' | 'manager' | 'clinician' | 'receptionist';
  disciplineNames: string[];
  specialtyCode: string | null;
  isPrescriber?: boolean;
}

interface PersonName {
  givenName: string;
  familyName: string;
}

interface LoginRow {
  site: string;
  title: string;
  role: string;
  discipline: string;
  email: string;
  password: string;
}

const SOHAM_CLINIC_NAME = 'Soham Health';
const DEMO_PASSWORD = 'Password1!';
const DEMO_EMAIL_DOMAIN = 'sohamhealth.demo';

const SITE_STAFF_TEMPLATE: StaffSeedTemplate[] = [
  {
    templateId: 'consultant-psychiatrist-1',
    title: 'Consultant Psychiatrist 1',
    role: 'clinician',
    disciplineNames: ['Psychiatry'],
    specialtyCode: 'mental_health',
    isPrescriber: true,
  },
  {
    templateId: 'consultant-psychiatrist-2',
    title: 'Consultant Psychiatrist 2',
    role: 'clinician',
    disciplineNames: ['Psychiatry'],
    specialtyCode: 'mental_health',
    isPrescriber: true,
  },
  {
    templateId: 'junior-medical-officer-1',
    title: 'Junior Medical Officer 1',
    role: 'clinician',
    disciplineNames: ['Psychiatry'],
    specialtyCode: 'mental_health',
    isPrescriber: true,
  },
  {
    templateId: 'junior-medical-officer-2',
    title: 'Junior Medical Officer 2',
    role: 'clinician',
    disciplineNames: ['Psychiatry'],
    specialtyCode: 'mental_health',
    isPrescriber: true,
  },
  {
    templateId: 'team-leader',
    title: 'Team Leader',
    role: 'manager',
    disciplineNames: ['Mental Health Nursing'],
    specialtyCode: 'mental_health',
  },
  {
    templateId: 'key-clinician-clinical-psychologist',
    title: 'Key Clinician - Clinical Psychologist',
    role: 'clinician',
    disciplineNames: ['Clinical Psychology'],
    specialtyCode: 'mental_health',
  },
  {
    templateId: 'key-clinician-social-worker',
    title: 'Key Clinician - Social Worker',
    role: 'clinician',
    disciplineNames: ['Social Work'],
    specialtyCode: 'mental_health',
  },
  {
    templateId: 'key-clinician-occupational-therapist',
    title: 'Key Clinician - Occupational Therapist',
    role: 'clinician',
    disciplineNames: ['Occupational Therapy'],
    specialtyCode: 'mental_health',
  },
  {
    templateId: 'key-clinician-peer-support-worker',
    title: 'Key Clinician - Peer Support Worker',
    role: 'clinician',
    disciplineNames: ['Peer Support Work'],
    specialtyCode: 'mental_health',
  },
];

const GLOBAL_STAFF_TEMPLATE: StaffSeedTemplate[] = [
  {
    templateId: 'regional-operations-manager',
    title: 'Regional Operations Manager',
    role: 'manager',
    disciplineNames: ['Administrative Support'],
    specialtyCode: null,
  },
  {
    templateId: 'clinical-director-psychiatry',
    title: 'Clinical Director (Psychiatry)',
    role: 'manager',
    disciplineNames: ['Psychiatry'],
    specialtyCode: 'mental_health',
    isPrescriber: true,
  },
];

const NAME_POOL: readonly PersonName[] = [
  { givenName: 'Ethan', familyName: 'Wright' },
  { givenName: 'Sophie', familyName: 'Mitchell' },
  { givenName: 'Arjun', familyName: 'Mehta' },
  { givenName: 'Olivia', familyName: 'Bennett' },
  { givenName: 'Noah', familyName: 'Sullivan' },
  { givenName: 'Grace', familyName: 'Campbell' },
  { givenName: 'Lucas', familyName: 'Anderson' },
  { givenName: 'Mia', familyName: 'Thompson' },
  { givenName: 'Henry', familyName: 'Walker' },
  { givenName: 'Amelia', familyName: 'Carter' },
  { givenName: 'Aiden', familyName: 'Reynolds' },
  { givenName: 'Chloe', familyName: 'Davies' },
  { givenName: 'Samuel', familyName: 'Morgan' },
  { givenName: 'Zoe', familyName: 'Patel' },
  { givenName: 'Liam', familyName: 'Henderson' },
  { givenName: 'Hannah', familyName: 'Price' },
  { givenName: 'Oscar', familyName: 'Coleman' },
  { givenName: 'Ella', familyName: 'Harper' },
  { givenName: 'Benjamin', familyName: 'Roberts' },
  { givenName: 'Ava', familyName: 'Foster' },
  { givenName: 'Mason', familyName: 'Stephens' },
  { givenName: 'Ruby', familyName: 'Fisher' },
  { givenName: 'Logan', familyName: 'Martin' },
  { givenName: 'Isla', familyName: 'Nguyen' },
  { givenName: 'Jacob', familyName: 'Murphy' },
  { givenName: 'Layla', familyName: 'Sharma' },
  { givenName: 'Daniel', familyName: 'Brooks' },
  { givenName: 'Matilda', familyName: 'Walsh' },
  { givenName: 'Thomas', familyName: 'Grant' },
  { givenName: 'Charlotte', familyName: 'Russell' },
  { givenName: 'Jack', familyName: 'Evans' },
  { givenName: 'Evie', familyName: 'Parker' },
  { givenName: 'Alexander', familyName: 'Hamilton' },
  { givenName: 'Lucy', familyName: 'Khan' },
  { givenName: 'Cooper', familyName: 'Richardson' },
  { givenName: 'Scarlett', familyName: 'Bailey' },
  { givenName: 'William', familyName: 'Bell' },
  { givenName: 'Abigail', familyName: 'Hughes' },
  { givenName: 'Harrison', familyName: 'Adams' },
  { givenName: 'Georgia', familyName: 'Jenkins' },
  { givenName: 'Levi', familyName: 'Perry' },
  { givenName: 'Sienna', familyName: 'Ali' },
  { givenName: 'Nathan', familyName: 'Wood' },
  { givenName: 'Lily', familyName: 'Dawson' },
  { givenName: 'Caleb', familyName: 'Ward' },
  { givenName: 'Harriet', familyName: 'Mills' },
  { givenName: 'Dylan', familyName: 'Hudson' },
  { givenName: 'Poppy', familyName: 'Ford' },
  { givenName: 'Ryan', familyName: 'Webb' },
  { givenName: 'Eliza', familyName: 'Singh' },
  { givenName: 'Connor', familyName: 'Baker' },
  { givenName: 'Madison', familyName: 'Gill' },
  { givenName: 'Isaac', familyName: 'Owens' },
  { givenName: 'Freya', familyName: 'George' },
  { givenName: 'Jordan', familyName: 'Knight' },
  { givenName: 'Aaliyah', familyName: 'Cheung' },
  { givenName: 'Evelyn', familyName: 'Moore' },
  { givenName: 'Harvey', familyName: 'Larsen' },
  { givenName: 'Anika', familyName: 'Rao' },
  { givenName: 'Julian', familyName: 'Bishop' },
  { givenName: 'Nora', familyName: 'Connelly' },
  { givenName: 'Marcus', familyName: 'Liu' },
  { givenName: 'Priya', familyName: 'Menon' },
  { givenName: 'Mitchell', familyName: 'Santos' },
  { givenName: 'Tara', familyName: 'Vella' },
  { givenName: 'Blake', familyName: 'Simmons' },
  { givenName: 'Renee', familyName: 'Mason' },
  { givenName: 'Kieran', familyName: 'Douglas' },
];

function toEmailToken(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/\.+/g, '.')
    .replace(/^\./, '')
    .replace(/\.$/, '');
}

function buildEmail(givenName: string, familyName: string): string {
  return `${toEmailToken(givenName)}.${toEmailToken(familyName)}@${DEMO_EMAIL_DOMAIN}`;
}

function buildPrescriberNumber(sequence: number): string {
  const base = 6100000 + sequence;
  return `${base}A`;
}

async function resolveDisciplineForTemplate(
  clinicId: string,
  disciplineByName: Map<string, DisciplineRow>,
  template: StaffSeedTemplate,
): Promise<DisciplineRow> {
  for (const disciplineName of template.disciplineNames) {
    const existing = disciplineByName.get(disciplineName.toLowerCase());
    if (existing) return existing;
  }

  const primaryName = template.disciplineNames[0];
  if (!primaryName) {
    throw new Error(`No discipline candidates provided for template ${template.templateId}`);
  }

  const now = new Date();
  const maxSortOrderRow = await dbAdmin('professional_disciplines')
    .where({ clinic_id: clinicId })
    .max<{ max_sort_order: number | null }>('sort_order as max_sort_order')
    .first();
  const sortOrder = ((maxSortOrderRow?.max_sort_order as number | null | undefined) ?? 0) + 10;

  const insertRow: DisciplineRow = {
    id: randomUUID(),
    name: primaryName,
  };

  await dbAdmin('professional_disciplines').insert({
    id: insertRow.id,
    clinic_id: clinicId,
    name: insertRow.name,
    is_active: true,
    sort_order: sortOrder,
    created_at: now,
    updated_at: now,
  });

  disciplineByName.set(insertRow.name.toLowerCase(), insertRow);
  return insertRow;
}

async function runInClinicRlsContext<T>(clinicId: string, work: () => Promise<T>): Promise<T> {
  return appPoolRaw.transaction(async (trx) => {
    await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [clinicId]);
    return await new Promise<T>((resolve, reject) => {
      rlsStore.run(trx, () => {
        work().then(resolve).catch(reject);
      });
    });
  });
}

async function cleanupPriorDemoRows(clinicId: string): Promise<number> {
  const now = new Date();
  const stale = await dbAdmin('staff')
    .where({ clinic_id: clinicId })
    .where((qb) => qb
      .whereILike('email', `%@soham.demo.local`)
      .orWhereILike('email', `%@demo.local`)
      .orWhereILike('email', `%@${DEMO_EMAIL_DOMAIN}`))
    .whereNull('deleted_at')
    .select('id', 'email');

  for (const row of stale) {
    const staffId = row.id as string;
    await dbAdmin('staff_team_assignments').where({ staff_id: staffId, clinic_id: clinicId }).del();
    await dbAdmin('staff_specialties').where({ staff_id: staffId, clinic_id: clinicId }).del();
    await dbAdmin('staff_module_access').where({ staff_id: staffId, clinic_id: clinicId }).del().catch(() => undefined);
    await dbAdmin('staff_settings').where({ staff_id: staffId }).del().catch(() => undefined);
    await dbAdmin('staff_sessions').where({ staff_id: staffId }).del().catch(() => undefined);
    await dbAdmin('staff').where({ id: staffId }).update({
      email: `archived.${staffId}@invalid.local`,
      is_active: false,
      deleted_at: now,
      updated_at: now,
    });
  }

  return stale.length;
}

async function replaceAssignmentsForSites(
  staffId: string,
  clinicId: string,
  sites: OrgUnitRow[],
  today: string,
  now: Date,
): Promise<void> {
  await dbAdmin('staff_team_assignments')
    .where({ staff_id: staffId, clinic_id: clinicId })
    .update({
      is_active: false,
      end_date: today,
      updated_at: now,
    });

  for (const site of sites) {
    await dbAdmin('staff_team_assignments').insert({
      id: randomUUID(),
      staff_id: staffId,
      org_unit_id: site.id,
      clinic_id: clinicId,
      start_date: today,
      end_date: null,
      is_active: true,
      created_at: now,
      updated_at: now,
    });
  }
}

async function seed(): Promise<void> {
  const clinic = (await dbAdmin('clinics')
    .where({ name: SOHAM_CLINIC_NAME, is_active: true })
    .whereNull('deleted_at')
    .first('id', 'name')) as ClinicRow | undefined;

  if (!clinic) {
    throw new Error(`Clinic "${SOHAM_CLINIC_NAME}" not found.`);
  }

  const siteUnits = (await dbAdmin('org_units')
    .where({ clinic_id: clinic.id, level: '2' })
    .orderBy('name', 'asc')
    .select('id', 'name')) as OrgUnitRow[];

  if (siteUnits.length === 0) {
    throw new Error(`No level-2 site units found for clinic "${clinic.name}".`);
  }

  const disciplineRows = (await dbAdmin('professional_disciplines')
    .where({ clinic_id: clinic.id, is_active: true })
    .select('id', 'name')) as DisciplineRow[];
  const disciplineByName = new Map(disciplineRows.map((row) => [row.name.toLowerCase(), row]));

  const requiredNameCount =
    siteUnits.length * SITE_STAFF_TEMPLATE.length + GLOBAL_STAFF_TEMPLATE.length;
  if (NAME_POOL.length < requiredNameCount) {
    throw new Error(`NAME_POOL too small: need ${requiredNameCount}, have ${NAME_POOL.length}.`);
  }

  const removedCount = await cleanupPriorDemoRows(clinic.id);

  const staffService = new StaffService(new StaffRepository());
  const seedAuth: AuthContext = {
    staffId: 'system',
    clinicId: clinic.id,
    role: 'admin',
    permissions: [],
  };

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const loginRows: LoginRow[] = [];

  let nameIndex = 0;
  for (const site of siteUnits) {
    for (const template of SITE_STAFF_TEMPLATE) {
      const person = NAME_POOL[nameIndex++];
      const email = buildEmail(person.givenName, person.familyName);
      const discipline = await resolveDisciplineForTemplate(clinic.id, disciplineByName, template);
      const prescriberNumber = template.isPrescriber
        ? buildPrescriberNumber(nameIndex)
        : undefined;

      const created = await runInClinicRlsContext(clinic.id, async () =>
        staffService.createStaff(
          clinic.id,
          {
            givenName: person.givenName,
            familyName: person.familyName,
            email,
            password: DEMO_PASSWORD,
            role: template.role,
            discipline: discipline.id,
            settingsProfileTabVisible: false,
            isPrescriber: template.isPrescriber ?? false,
            prescriberNumber,
            specialties: template.specialtyCode
              ? [{ code: template.specialtyCode, isPrimary: true }]
              : undefined,
          },
          seedAuth,
        ));

      await dbAdmin('staff').where({ id: created.id }).update({
        must_change_password: false,
        failed_login_attempts: 0,
        locked_until: null,
        updated_at: now,
      });

      await replaceAssignmentsForSites(
        created.id,
        clinic.id,
        [site],
        today,
        now,
      );

      loginRows.push({
        site: site.name,
        title: template.title,
        role: template.role,
        discipline: discipline.name,
        email,
        password: DEMO_PASSWORD,
      });
    }
  }

  for (const template of GLOBAL_STAFF_TEMPLATE) {
    const person = NAME_POOL[nameIndex++];
    const email = buildEmail(person.givenName, person.familyName);
    const discipline = await resolveDisciplineForTemplate(clinic.id, disciplineByName, template);
    const prescriberNumber = template.isPrescriber
      ? buildPrescriberNumber(nameIndex)
      : undefined;

    const created = await runInClinicRlsContext(clinic.id, async () =>
      staffService.createStaff(
        clinic.id,
        {
          givenName: person.givenName,
          familyName: person.familyName,
          email,
          password: DEMO_PASSWORD,
          role: template.role,
          discipline: discipline.id,
          settingsProfileTabVisible: false,
          isPrescriber: template.isPrescriber ?? false,
          prescriberNumber,
          specialties: template.specialtyCode
            ? [{ code: template.specialtyCode, isPrimary: true }]
            : undefined,
        },
        seedAuth,
      ));

    await dbAdmin('staff').where({ id: created.id }).update({
      must_change_password: false,
      failed_login_attempts: 0,
      locked_until: null,
      updated_at: now,
    });

    await replaceAssignmentsForSites(
      created.id,
      clinic.id,
      siteUnits,
      today,
      now,
    );

    loginRows.push({
      site: 'All Soham Sites',
      title: template.title,
      role: template.role,
      discipline: discipline.name,
      email,
      password: DEMO_PASSWORD,
    });
  }

  const outDir = path.resolve(__dirname, '..', '..', '..', 'docs', 'demo');
  const outPath = path.join(outDir, 'soham-mh-staff-logins.md');
  await mkdir(outDir, { recursive: true });

  const lines: string[] = [
    '# Soham Health Demo Staff Logins',
    '',
    '> Demo-only accounts seeded with the staff creation workflow and AU mental-health disciplines.',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Clinic: ${clinic.name}`,
    `Sites covered: ${siteUnits.length}`,
    `Old demo rows cleaned: ${removedCount}`,
    `Accounts created: ${loginRows.length}`,
    '',
    'Per-site staffing package:',
    '- 2 Consultant Psychiatrists',
    '- 2 Junior Medical Officers',
    '- 1 Team Leader (non-medical)',
    '- 4 Key Clinicians (non-medical)',
    '',
    'Cross-site leadership package:',
    '- 1 Regional Operations Manager (non-medical) across all sites',
    '- 1 Clinical Director (medical) across all sites',
    '',
    '| Site | Role | Discipline | Username (email) | Password |',
    '|---|---|---|---|---|',
  ];

  for (const row of loginRows) {
    lines.push(
      `| ${row.site} | ${row.title} | ${row.discipline} | ${row.email} | \`${row.password}\` |`,
    );
  }
  lines.push('');

  await writeFile(outPath, `${lines.join('\n')}\n`, 'utf8');

  console.log(
    JSON.stringify(
      {
        clinic: clinic.name,
        sites: siteUnits.length,
        cleaned: removedCount,
        accounts: loginRows.length,
        output: outPath,
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

// Phase 0.8 — Good Health demo catalog.
//
// Fictional organisation spec for the deterministic demo seed. Every
// piece of domain data (clinic names, suburbs, time zones, programs,
// department labels) lives here as plain typed data so generators stay
// thin row-mappers. Reviewers should read this file to understand
// "what does the Good Health tenant look like" without stepping into
// any insert code.
//
// Non-negotiable:
//   - No Math.random, no Date.now inside this file (pure data).
//   - Slugs are the canonical keys uuidv5 uses to derive ids. Never
//     rename a slug after the first seed run — every id would move.
//   - Strings are the rendered human labels. Safe to tweak.

export interface CatalogClinic {
  readonly slug: string;
  readonly name: string;
  readonly legalName: string;
  readonly abn: string;      // fictional but E.164-valid format
  readonly timeZone: string;
  readonly suburb: string;
  readonly state: 'VIC' | 'NSW' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';
  readonly postcode: string;
  readonly kind: 'mental_health' | 'executive';
}

// Four clinical sites + one executive/corporate tenant that houses
// non-clinical staff (CEO, CMO, CNO, CIO, Privacy Officer, HODs for
// the non-MH departments) without anchoring them to a clinical site.
// The executive tenant never sees patients; its RLS isolation is a
// side benefit — it proves cross-tenant org rollups will need an
// explicit cross-tenant audit role when they ship.
export const CLINICS: readonly CatalogClinic[] = [
  {
    slug: 'northern',
    name: 'Good Health Northern Mind Clinic',
    legalName: 'Good Health Northern Mental Health Pty Ltd',
    abn: '11 000 000 001',
    timeZone: 'Australia/Melbourne',
    suburb: 'Preston',
    state: 'VIC',
    postcode: '3072',
    kind: 'mental_health',
  },
  {
    slug: 'eastern',
    name: 'Good Health Eastern Mind Clinic',
    legalName: 'Good Health Eastern Mental Health Pty Ltd',
    abn: '11 000 000 002',
    timeZone: 'Australia/Melbourne',
    suburb: 'Box Hill',
    state: 'VIC',
    postcode: '3128',
    kind: 'mental_health',
  },
  {
    slug: 'southern',
    name: 'Good Health Southern Mind Clinic',
    legalName: 'Good Health Southern Mental Health Pty Ltd',
    abn: '11 000 000 003',
    timeZone: 'Australia/Melbourne',
    suburb: 'Frankston',
    state: 'VIC',
    postcode: '3199',
    kind: 'mental_health',
  },
  {
    slug: 'western',
    name: 'Good Health Western Mind Clinic',
    legalName: 'Good Health Western Mental Health Pty Ltd',
    abn: '11 000 000 004',
    timeZone: 'Australia/Melbourne',
    suburb: 'Footscray',
    state: 'VIC',
    postcode: '3011',
    kind: 'mental_health',
  },
  {
    slug: 'executive',
    name: 'Good Health Executive',
    legalName: 'Good Health Holdings Pty Ltd',
    abn: '11 000 000 000',
    timeZone: 'Australia/Melbourne',
    suburb: 'Melbourne',
    state: 'VIC',
    postcode: '3000',
    kind: 'executive',
  },
];

export const MENTAL_HEALTH_CLINICS = CLINICS.filter((c) => c.kind === 'mental_health');

// Team slugs are fixed Alpha / Beta per clinic so later generators
// (patients assigned to teams, group programs hosted by teams, etc)
// can reference them without threading a lookup table.
export const TEAM_SLUGS = ['alpha', 'beta'] as const;
export type TeamSlug = (typeof TEAM_SLUGS)[number];

export interface CatalogProgram {
  readonly slug: string;
  readonly name: string;
  // Which team (Alpha / Beta) hosts the program inside its clinic.
  // Both teams host CBT + DBT but the slug differentiates.
  readonly teamSlugs: readonly TeamSlug[];
}

// Executive + corporate staff attached to the 'executive' clinic
// tenant. These personas never hold a specialty or own a clinical
// caseload — they exist so "log in as the CMO and see the admin
// dashboard" is a one-click demo, and so the DB has at least one
// row per Role enum value for RBAC smoke tests.
export interface CatalogExecutiveStaff {
  readonly slug: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly titleLabel: string;
  readonly role: 'superadmin' | 'admin';
  readonly discipline: string;
}

export const EXECUTIVE_STAFF: readonly CatalogExecutiveStaff[] = [
  {
    slug: 'ceo',
    givenName: 'Eleanor',
    familyName: 'Whitfield',
    titleLabel: 'Chief Executive Officer',
    role: 'superadmin',
    discipline: 'Executive',
  },
  {
    slug: 'cmo',
    givenName: 'Raymond',
    familyName: 'Kaur',
    titleLabel: 'Chief Medical Officer',
    role: 'superadmin',
    discipline: 'Psychiatry',
  },
  {
    slug: 'cno',
    givenName: 'Catherine',
    familyName: 'Okafor',
    titleLabel: 'Chief Nursing Officer',
    role: 'admin',
    discipline: 'Nursing',
  },
  {
    slug: 'cio',
    givenName: 'Hiroshi',
    familyName: 'Nakamura',
    titleLabel: 'Chief Information Officer',
    role: 'admin',
    discipline: 'Informatics',
  },
  {
    slug: 'privacy-officer',
    givenName: 'Margaret',
    familyName: 'Duvall',
    titleLabel: 'Privacy & Compliance Officer',
    role: 'admin',
    discipline: 'Governance',
  },
];

// Department heads — one per specialty. Every HOD anchors to the
// executive tenant (they're corporate-level clinical leads) and gets
// a staff_specialties row tying them to their domain. The specialty
// codes referenced here MUST exist in the specialties lookup table,
// which is seeded by apps/api/migrations/20260420000000_specialties_core.ts.
export interface CatalogDepartmentHead {
  readonly slug: string;
  readonly givenName: string;
  readonly familyName: string;
  readonly titleLabel: string;
  readonly specialtyCode:
    | 'mental_health'
    | 'general_medicine'
    | 'endocrinology'
    | 'paediatrics'
    | 'obstetrics_gynaecology'
    | 'surgery'
    | 'oncology';
  readonly discipline: string;
}

export const DEPARTMENT_HEADS: readonly CatalogDepartmentHead[] = [
  {
    slug: 'hod-mental-health',
    givenName: 'Alistair',
    familyName: 'Montgomery',
    titleLabel: 'Head of Department — Mental Health',
    specialtyCode: 'mental_health',
    discipline: 'Psychiatry',
  },
  {
    slug: 'hod-general-medicine',
    givenName: 'Priya',
    familyName: 'Ramaswamy',
    titleLabel: 'Head of Department — General Medicine',
    specialtyCode: 'general_medicine',
    discipline: 'Internal Medicine',
  },
  {
    slug: 'hod-endocrinology',
    givenName: 'Jonas',
    familyName: 'Lindqvist',
    titleLabel: 'Head of Department — Endocrinology',
    specialtyCode: 'endocrinology',
    discipline: 'Endocrinology',
  },
  {
    slug: 'hod-paediatrics',
    givenName: 'Yuki',
    familyName: 'Tanaka',
    titleLabel: 'Head of Department — Paediatrics',
    specialtyCode: 'paediatrics',
    discipline: 'Paediatrics',
  },
  {
    slug: 'hod-obs-gyne',
    givenName: 'Amara',
    familyName: 'Diallo',
    titleLabel: 'Head of Department — Obstetrics & Gynaecology',
    specialtyCode: 'obstetrics_gynaecology',
    discipline: 'Obstetrics & Gynaecology',
  },
  {
    slug: 'hod-surgery',
    givenName: 'Rafael',
    familyName: 'Costa',
    titleLabel: 'Head of Department — Surgery',
    specialtyCode: 'surgery',
    discipline: 'General Surgery',
  },
  {
    slug: 'hod-oncology',
    givenName: 'Helena',
    familyName: 'Abramowitz',
    titleLabel: 'Head of Department — Oncology',
    specialtyCode: 'oncology',
    discipline: 'Medical Oncology',
  },
];

// Clinical staff roster — 10 personas per team, replicated across
// every (clinic, team) pair. Each role slot holds the job title,
// Role enum value, discipline, and short label used to derive the
// person's plaintext demo password. Names are drawn from CLINIC_NAME_POOL
// via a seeded PRNG so the assignment is deterministic + diverse but
// not hand-curated.
export interface CatalogClinicRole {
  readonly slug: string;
  readonly titleLabel: string;
  readonly role: 'clinician' | 'receptionist';
  readonly discipline: string;
  readonly passwordToken: string;
}

export const CLINIC_ROLE_ROSTER: readonly CatalogClinicRole[] = [
  {
    slug: 'team-lead',
    titleLabel: 'Consultant Psychiatrist (Team Lead)',
    role: 'clinician',
    discipline: 'Psychiatry',
    passwordToken: 'TeamLead',
  },
  {
    slug: 'registrar-1',
    titleLabel: 'Psychiatry Registrar',
    role: 'clinician',
    discipline: 'Psychiatry',
    passwordToken: 'Registrar',
  },
  {
    slug: 'registrar-2',
    titleLabel: 'Psychiatry Registrar',
    role: 'clinician',
    discipline: 'Psychiatry',
    passwordToken: 'Registrar',
  },
  {
    slug: 'psychologist',
    titleLabel: 'Clinical Psychologist',
    role: 'clinician',
    discipline: 'Psychology',
    passwordToken: 'Psychologist',
  },
  {
    slug: 'ot',
    titleLabel: 'Occupational Therapist',
    role: 'clinician',
    discipline: 'Occupational Therapy',
    passwordToken: 'OT',
  },
  {
    slug: 'social-worker',
    titleLabel: 'Social Worker',
    role: 'clinician',
    discipline: 'Social Work',
    passwordToken: 'SW',
  },
  {
    slug: 'nurse-1',
    titleLabel: 'Mental Health Nurse',
    role: 'clinician',
    discipline: 'Nursing',
    passwordToken: 'MHN',
  },
  {
    slug: 'nurse-2',
    titleLabel: 'Mental Health Nurse',
    role: 'clinician',
    discipline: 'Nursing',
    passwordToken: 'MHN',
  },
  {
    slug: 'case-coordinator',
    titleLabel: 'Case Coordinator',
    role: 'clinician',
    discipline: 'Care Coordination',
    passwordToken: 'Coordinator',
  },
  {
    slug: 'admin',
    titleLabel: 'Administrative Officer',
    role: 'receptionist',
    discipline: 'Administration',
    passwordToken: 'Admin',
  },
];

// Deterministic name pool, diverse across cultural origins. The staff
// generator picks via a seeded PRNG so every (clinic, team, slot)
// triple maps to the same name on every reseed. Expand the pool as
// needed — just never reorder (insertions at the end are safe, the
// first N entries must keep their index so older reseeds match).
export const GIVEN_NAMES: readonly string[] = [
  'Harriet', 'Simon', 'Naomi', 'Declan', 'Aishwarya', 'Mateo', 'Farida',
  'Benjamin', 'Claire', 'Omar', 'Rosa', 'Trent', 'Lakshmi', 'Noah',
  'Isabella', 'Yusuf', 'Gemma', 'Hugo', 'Keira', 'Tobias',
  'Mia', 'Elias', 'Sana', 'Lachlan', 'Kiri', 'Arman', 'Frida',
  'Joshua', 'Anaya', 'Rory', 'Hana', 'Caleb', 'Mireille', 'Tomas',
  'Irene', 'Fergus', 'Mei', 'Oscar', 'Priyanka', 'Aaron',
];

export const FAMILY_NAMES: readonly string[] = [
  'Whitaker', 'Nguyen', 'Singh', 'Okonkwo', 'Rossi', 'Hernandez',
  'Patel', 'Clarke', 'Yamamoto', 'Abara', 'Moreau', 'Schwartz',
  'Hassan', 'Brennan', 'Kapoor', 'Lindgren', 'Costa', 'Joshi',
  'Dube', 'Hart', 'Petrova', 'Tanaka', 'Khoury', 'Matheson',
  'Garcia', 'Fitzgerald', 'Olsen', 'Dinh', 'Mabaso', 'Brodsky',
  'Iyer', 'Holmgren', 'Papadopoulos', 'Okafor', 'Nkomo', 'Beltran',
  'Chowdhury', 'Rivera', 'Soerensen', 'Aleksandrov',
];

// Patient name pools — deliberately disjoint from the staff pools so
// a patient never shares a name with a clinician in the same tenant
// (a cheap but effective demo-anti-confusion rule). Drawn via a
// seeded rng forked on (clinic, team) in the patient generator.
export const PATIENT_GIVEN_NAMES: readonly string[] = [
  'Akira', 'Beatrice', 'Cassidy', 'Damian', 'Elena', 'Fabian', 'Gwen',
  'Heidi', 'Idris', 'Juno', 'Keanu', 'Lorna', 'Malik', 'Nadia',
  'Oren', 'Paulo', 'Quinn', 'Ravi', 'Saoirse', 'Tomas',
  'Ursula', 'Vikram', 'Willa', 'Xiomara', 'Yolanda', 'Zane',
  'Amira', 'Bruno', 'Celine', 'Dmitri', 'Esme', 'Finn', 'Greta',
  'Haruki', 'Ines', 'Javier', 'Kira', 'Leif', 'Mila', 'Nolan',
];

export const PATIENT_FAMILY_NAMES: readonly string[] = [
  'Ashford', 'Bergstrom', 'Castellanos', 'Donnelly', 'Esposito',
  'Forsythe', 'Guevara', 'Halvorsen', 'Ignatieff', 'Jagger',
  'Kozlowski', 'Langford', 'Marchetti', 'Ngata', 'Osterman',
  'Penhaligon', 'Qureshi', 'Rademacher', 'Sullivan', 'Thackeray',
  'Ustinov', 'Valdez', 'Winslow', 'Xanthopoulos', 'Yeboah',
  'Zetterberg', 'Alvarado', 'Bencosme', 'Cavendish', 'Drysdale',
  'Escudero', 'Fujimoto', 'Galloway', 'Hartwell', 'Iglesias',
  'Jablonski', 'Kensington', 'Lachance', 'Merriweather', 'Novak',
];

// How many patients per (clinic, team) — 10 each × 2 teams × 4 MH
// clinics = 80 patients total. Keeps the cohort small enough to
// reseed in under a minute while still large enough to show list
// pagination, multi-clinic RLS isolation, and per-team caseloads.
export const PATIENTS_PER_TEAM = 10;

export const PROGRAMS: readonly CatalogProgram[] = [
  { slug: 'cbt',             name: 'Cognitive Behavioural Therapy', teamSlugs: ['alpha', 'beta'] },
  { slug: 'dbt',             name: 'Dialectical Behaviour Therapy', teamSlugs: ['alpha', 'beta'] },
  { slug: 'early-psychosis', name: 'Early Psychosis Intervention',  teamSlugs: ['alpha'] },
  { slug: 'mood-recovery',   name: 'Mood Disorders Recovery',       teamSlugs: ['beta'] },
  { slug: 'anxiety-group',   name: 'Anxiety Management Group',      teamSlugs: ['alpha', 'beta'] },
];

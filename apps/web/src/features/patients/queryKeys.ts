// apps/web/src/features/patients/queryKeys.ts
//
// Phase 0.7 PR2 Class F — React Query key factory for the patients cluster
// (CLAUDE.md §4.1). This is the largest factory in the app: the patient
// detail layout ships ~25 tabs, each calling multiple patient-scoped
// queries. All of them go through this factory so mutation invalidation
// prefixes can't drift from query key prefixes (the MEDS1-10 bug class).
//
// ── Design notes ──────────────────────────────────────────────────────────
//
// 1. Top-level patient-owned keys live under `patientsKeys.*`
//    (list, detail, contacts, providers, flags, alerts, attachments, notes,
//    messages, carers, etc.).
//
// 2. Sub-domain keys that are only ever read inside a patient detail tab
//    (clozapine-*, ect-*, viva-*, tms-*, life-chart, inpatient-*, etc.)
//    live under domain-specific exports that follow the same
//    `all | list(patientId) | detail(id) | byXxx(...)` shape. They are
//    exported as separate objects rather than nested under patientsKeys so
//    call sites can import just what they need.
//
// 3. Cross-feature namespaces (e.g. `['medications', patientId]`,
//    `['allergies', patientId]`, `['episodes', patientId]`) are NOT
//    re-declared here — the calling tabs import from the owning feature's
//    factory instead (medications/queryKeys.ts, risk-allergies/queryKeys.ts,
//    etc.). Only patient-owned and patient-detail-private keys live here.
//
// 4. Where a sub-domain key first-element differs from the sub-domain's
//    canonical feature name (e.g. `['correspondence', patientId, 'peer', subType]`),
//    we keep the literal first element in the returned tuple so existing
//    cross-tab invalidations continue to work. Changing cache shapes would
//    break in-flight sessions.

// ─── Messaging (cross-feature — namespace preserved as literal) ──────────
// These tuples start with ['messages', ...] which belongs to the messaging
// feature. We preserve them here so a broad messaging invalidation still
// matches queries issued from patient tabs.
export const messagingCrossKeys = {
  threadsForPatient: (patientId: string) =>
    ['messages', 'threads', { patientId }] as const,
  thread: (threadId: string | null) => ['messages', 'thread', threadId] as const,
} as const;

// ─── Core patient-owned keys ──────────────────────────────────────────────
export const patientsKeys = {
  all: ['patients'] as const,
  list: (filters?: Record<string, unknown>) =>
    filters ? [...patientsKeys.all, 'list', filters] as const : [...patientsKeys.all, 'list'] as const,
  detail: (patientId: string) => ['patient', patientId] as const,
  detailAll: () => ['patient'] as const,
  // banner/summary/quick-fetch shapes
  banner: (patientId: string) => ['patient', patientId, 'banner'] as const,
  detailMeta: (patientId: string) => ['patient-detail', patientId] as const,
  // Contacts, providers, flags
  contacts: (patientId: string) => ['patient-contacts', patientId] as const,
  contactsAlt: (patientId: string) => ['patientContacts', patientId] as const,  // legacy camelCase
  providers: (patientId: string) => ['patientProviders', patientId] as const,
  flags: (patientId: string) => ['patient-flags', patientId] as const,
  // Attachments, alerts, messages, carers
  attachments: (patientId: string) => ['patient-attachments', patientId] as const,
  alerts: (patientId: string) => ['patient-alerts', patientId] as const,
  diagnoses: (patientId: string) => ['patient-diagnoses', patientId] as const,
  messages: (patientId: string) => ['patient-messages', patientId] as const,
  carers: (patientId: string) => ['carers', patientId] as const,
  // Notes (patient-level and by type)
  notes: (patientId: string) => ['patient-notes', patientId] as const,
  notesAll: () => ['patient-notes'] as const,
  notesByEpisode: (patientId: string, episodeId: string | undefined) =>
    ['patient-notes', patientId, episodeId] as const,
  notesAssessments: (patientId: string) => ['patient-notes', patientId, 'assessments'] as const,
  notesAllPlans: (patientId: string) => ['patient-notes', patientId, 'all-plans'] as const,
  notesRecoveryLegacy: (patientId: string) => ['patient-notes', patientId, 'recovery-legacy'] as const,
  notesLifechart: (patientId: string) => ['patient-notes', patientId, 'lifechart'] as const,
  notesLast: (patientId: string) => ['patient-notes', patientId, 'last'] as const,
  notesReviews: (patientId: string) => ['patient-notes', patientId, 'reviews'] as const,
  // Audit Tier 9.2 — pathway-scoped notes view (SummaryTab pathways
  // subtab) and the "linkages" cross-tab summary.
  notesPathway: (patientId: string, pathwayName: string) =>
    ['patient-notes', patientId, 'pathway', pathwayName] as const,
  notesLinkages: (patientId: string) => ['patient-notes', patientId, 'linkages'] as const,
  // Audit Tier 9.2 — alert + task life-chart / linkages views.
  alertsLifechart: (patientId: string) => ['patient-alerts', patientId, 'lifechart'] as const,
  tasksLinkages: (patientId: string) => ['tasks', patientId, 'linkages'] as const,
  // Audit Tier 9.2 — Patient list cross-cluster views.
  patientTeamAssignments: () => ['patients', 'team-assignments'] as const,
  patientAttachmentCounts: () => ['patients', 'attachment-counts'] as const,
  patientReviewStatus: () => ['patients', 'review-status'] as const,
  teamAssignmentsForStaff: (userId: string | null) =>
    ['staff-settings', 'team-assignments', userId ?? 'me'] as const,
  unitsFlat: () => ['org-settings', 'units-flat'] as const,
  referralSourcesLookup: () => ['staff-settings', 'referral-sources'] as const,
  providerSearchByPostcode: (term: string, postcode: string | undefined) =>
    ['nhsd-provider-search', term, postcode ?? ''] as const,
  tasksSummary: (patientId: string) => ['tasks', patientId, 'summary'] as const,
  notesIncidents: (patientId: string) => ['patient-notes-incidents', patientId] as const,
  notesPhysical: (patientId: string) => ['patient-notes-physical', patientId] as const,
  summarySignoffs: (patientId: string) => ['patient-summary-signoffs', patientId] as const,
  clinicalIntelligenceSummary: (patientId: string) =>
    ['patient-clinical-intelligence', patientId] as const,
  letterData: (patientId: string) => ['patient-letter-data', patientId] as const,
  // Appointments on the patient detail surface
  appointments: (patientId: string) => ['patient-appointments', patientId] as const,
  // Cross-feature helpers — these return tuples that match the canonical
  // feature factory output for the callers that invalidate "all of feature X
  // for this patient." They exist in patientsKeys because the invalidation
  // site lives inside the patient cluster.
  bulkReassign: {
    root: () => ['bulk-reassign-patients'] as const,
    byClinician: (clinicianId: string) => ['bulk-reassign-patients', 'clinician', clinicianId] as const,
    byTeam: (teamId: string) => ['bulk-reassign-patients', 'team', teamId] as const,
  },
  canDeactivate: (target: string) => ['can-deactivate', target] as const,
  providerSearch: (term: string) => ['nhsd-provider-search', term] as const,
  providerStatus: () => ['nhsd-status'] as const,
  rxnormSearch: (term: string) => ['rxnorm-drugs', term] as const,
  staffLookup: () => ['staff-lookup'] as const,
  staffPrescriber: (staffId: string | undefined) => ['staff-prescriber', staffId] as const,
  staff: (patientId?: string) => patientId ? ['staff', patientId] as const : ['staff'] as const,
  staffSettings: () => ['staff-settings'] as const,
  orgSettings: () => ['org-settings'] as const,
  selfRatingTemplates: () => ['self-rating-templates'] as const,
  legalOrderTypes: () => ['legal-order-types'] as const,
  tasks: (patientId: string) => ['tasks', patientId] as const,
  tasksByEpisode: (patientId: string, episodeId: string) => ['tasks', patientId, episodeId] as const,
  staffLookupShort: () => ['staff-lookup'] as const,
  hotspotsInvalidate: () => ['hotspots'] as const,
  waitlistInvalidate: () => ['admission-waitlist'] as const,
  tasksAll: () => ['tasks'] as const,
  patientSearch: (search: string) => ['patients', 'search', search] as const,
  staffSettingsAppointmentModes: () => ['staff-settings', 'appointment-modes'] as const,
  staffSettingsContactOptions: () => ['staff-settings', 'contact-options'] as const,
  alertTypes: () => ['patients', 'alert-types'] as const,
  plannedTransitions: (patientId?: string) =>
    patientId ? ['planned-transitions', patientId] as const : ['planned-transitions'] as const,
  plannedTransitionDetail: (transitionId: string | null) =>
    ['planned-transition-detail', transitionId] as const,
} as const;

// ─── Episode-scoped keys (under patients cluster) ────────────────────────
export const episodesKeys = {
  all: ['episodes'] as const,
  byPatient: (patientId: string) => ['episodes', patientId] as const,
  active: (patientId: string) => ['episodes', patientId, 'active'] as const,
  activeShort: (patientId: string) => ['active-episode', patientId] as const,
  lifeChart: (patientId: string) => ['episodes', patientId, 'lifechart'] as const,
  allocation: (episodeId: string) => ['episode-allocation', episodeId] as const,
  assessments: (episodeId: string) => ['episode-assessments', episodeId] as const,
  contacts: (patientId: string, episodeId?: string) =>
    episodeId ? ['episode-contacts', patientId, episodeId] as const : ['episode-contacts', patientId] as const,
  notes: (patientId: string, episodeId?: string) =>
    episodeId ? ['episode-notes', patientId, episodeId] as const : ['episode-notes', patientId] as const,
  notesAll: () => ['episode-notes'] as const,
  letters: (patientId: string, episodeId?: string) =>
    episodeId ? ['episode-letters', patientId, episodeId] as const : ['episode-letters', patientId] as const,
  lettersAll: () => ['episode-letters'] as const,
  messages: (patientId: string, episodeId: string) => ['episode-messages', patientId, episodeId] as const,
  types: () => ['episode-types'] as const,
} as const;

// ─── Appointments (patient detail surface) ───────────────────────────────
export const patientAppointmentsKeys = {
  all: ['appointments'] as const,
  byPatient: (patientId: string) => ['appointments', patientId] as const,
  summary: (patientId: string) => ['appointments', patientId, 'summary'] as const,
  linkages: (patientId: string) => ['appointments', patientId, 'linkages'] as const,
} as const;

// Re-export summary as the canonical shape for PatientDetailLayout tasks-summary queries.
// (tasksSummary lives under patientsKeys above for consistency with patientsKeys.tasks.)

// ─── Clinical notes (patient-scoped invalidations from the tabs) ─────────
export const patientNotesKeys = {
  rootClinical: () => ['clinical-notes'] as const,
  patientAll: (patientId: string) => ['clinical-notes', patientId] as const,
} as const;

// ─── Correspondence (patient letter / peer workflow) ─────────────────────
export const correspondenceKeys = {
  all: ['correspondence'] as const,
  byPatient: (patientId: string) => ['correspondence', patientId] as const,
  byPatientPeer: (patientId: string, subType: string) =>
    ['correspondence', patientId, 'peer', subType] as const,
  // USER-E.2: one-note fetch for composer prefill from ?fromNoteId=
  sourceNote: (noteId: string | null) =>
    ['correspondence', 'source-note', noteId ?? 'none'] as const,
} as const;

// ─── Risk / allergies / safety plans ─────────────────────────────────────
export const riskAllergiesKeys = {
  allergies: (patientId: string) => ['allergies', patientId] as const,
  allergiesBanner: (patientId: string) => ['allergies', patientId, 'banner'] as const,
  risks: (patientId: string) => ['risk-assessments', patientId] as const,
  // Audit Tier 9.2 — risk lifechart view (SummaryTab).
  risksLifechart: (patientId: string) => ['risk-assessments', patientId, 'lifechart'] as const,
  safetyPlans: (patientId: string) => ['safety-plans', patientId] as const,
} as const;

// ─── Medications (patient-scoped invalidations) ──────────────────────────
export const patientMedicationsKeys = {
  root: () => ['medications'] as const,
  byPatient: (patientId: string) => ['medications', patientId] as const,
  summary: (patientId: string) => ['medications', patientId, 'summary'] as const,
  lifechart: (patientId: string) => ['medications', patientId, 'lifechart'] as const,
} as const;

// ─── Pathology ───────────────────────────────────────────────────────────
export const pathologyKeys = {
  byPatient: (patientId: string) => ['pathology', patientId] as const,
  summary: (patientId: string) => ['pathology', patientId, 'summary'] as const,
  mdtByPatient: (patientId: string) => ['pathology-mdt', patientId] as const,
} as const;

// ─── Advance directives ──────────────────────────────────────────────────
export const advanceDirectivesKeys = {
  byPatient: (patientId: string) => ['advance-directives', patientId] as const,
} as const;

// ─── Legal orders ────────────────────────────────────────────────────────
export const legalOrdersKeys = {
  byPatient: (patientId: string) => ['legal-orders', patientId] as const,
  banner: (patientId: string) => ['legal-orders', patientId, 'banner'] as const,
  types: () => ['legal-order-types'] as const,
} as const;

// ─── Outcome measures ────────────────────────────────────────────────────
export const outcomeMeasuresKeys = {
  all: ['outcome-measures'] as const,
  byPatient: (patientId: string) => ['outcome-measures', patientId] as const,
  byPatientEpisode: (patientId: string, episodeId: string) =>
    ['outcome-measures', patientId, 'episode', episodeId] as const,
  summary: (patientId: string) => ['outcome-measures', patientId, 'summary'] as const,
  api: (patientId: string) => ['outcomes-api', patientId] as const,
  apiAll: () => ['outcomes-api'] as const,
  inpatient: (patientId: string) => ['inpatient-outcomes', patientId] as const,
  inpatientAll: () => ['inpatient-outcomes'] as const,
} as const;

// ─── Pathways / treatment pathways ───────────────────────────────────────
export const patientPathwaysKeys = {
  byPatient: (patientId: string) => ['pathways', patientId] as const,
  // Audit Tier 9.2 — cross-tab "linkages" summary.
  linkages: (patientId: string) => ['pathways', patientId, 'linkages'] as const,
} as const;

// ─── Physical health / tracking / nursing / structured obs ──────────────
export const physicalHealthKeys = {
  latest: (patientId: string) => ['physical-health-latest', patientId] as const,
  tracking: (patientId: string) => ['physical-tracking', patientId] as const,
  trackingAll: () => ['physical-tracking'] as const,
  nursingAssessments: (patientId: string) => ['nursing-assessments', patientId] as const,
  nursingAssessmentsAll: () => ['nursing-assessments'] as const,
  nursingAssessmentsRecoveryStar: (patientId: string) =>
    ['nursing-assessments', patientId, 'recovery-star'] as const,
  nursingAssessmentsNews2: (patientId: string) =>
    ['nursing-assessments', patientId, 'news2'] as const,
  nursingAssessmentsFallsRisk: (patientId: string) =>
    ['nursing-assessments', patientId, 'falls_risk'] as const,
  nursingAssessmentsFluidBalance: (patientId: string) =>
    ['nursing-assessments', patientId, 'fluid_balance'] as const,
  nursingAssessmentsWoundCare: (patientId: string) =>
    ['nursing-assessments', patientId, 'wound_care'] as const,
  // Audit Tier 9.2 — 91-day review window filter used by the
  // NinetyOneDayReviewTab query.
  nursingAssessments91d: (patientId: string) =>
    ['nursing-assessments', patientId, '91d'] as const,
  structuredObs: (patientId: string) => ['structured-observations', patientId] as const,
} as const;

// ─── Inpatient care + shift handover ─────────────────────────────────────
export const inpatientKeys = {
  notes: (patientId: string) => ['inpatient-notes', patientId] as const,
  notesAll: () => ['inpatient-notes'] as const,
  marAdministrations: (patientId: string) => ['mar-administrations', patientId] as const,
  marAdministrationsByDate: (patientId: string, date: string) =>
    ['mar-administrations', patientId, date] as const,
  marAdministrationsAll: () => ['mar-administrations'] as const,
  shiftHandovers: (patientId?: string) =>
    patientId ? ['shift-handovers', patientId] as const : ['shift-handovers'] as const,
  shiftHandoverAuto: (patientId?: string) =>
    patientId ? ['shift-handover-auto', patientId] as const : ['shift-handover-auto'] as const,
  sideEffectSchedules: (patientId: string) => ['side-effect-schedules', patientId] as const,
} as const;

// ─── Incidents ───────────────────────────────────────────────────────────
export const incidentsKeys = {
  comments: (patientId: string, incidentId: string | undefined) =>
    ['incident-comments', patientId, incidentId] as const,
} as const;

// ─── LAI (patient-detail medications tab) ────────────────────────────────
export const patientLaiKeys = {
  schedules: (patientId: string) => ['lai-schedules', patientId] as const,
  validations: (patientId: string) => ['lai-validations', patientId] as const,
} as const;

// ─── Clozapine ───────────────────────────────────────────────────────────
export const clozapineKeys = {
  registrations: (patientId: string) => ['clozapine-registrations', patientId] as const,
  monitoring: (regId: string) => ['clozapine-monitoring', regId] as const,
  titration: (regId: string) => ['clozapine-titration', regId] as const,
  admin: (regId: string) => ['clozapine-admin', regId] as const,
  blood: (regId: string) => ['clozapine-blood', regId] as const,
  obs: (regId: string) => ['clozapine-obs', regId] as const,
} as const;

// ─── ECT ─────────────────────────────────────────────────────────────────
export const ectKeys = {
  courses: (patientId: string) => ['ect-courses', patientId] as const,
  coursesAll: () => ['ect-courses'] as const,
  treatments: (patientId: string) => ['ect-treatments', patientId] as const,
  treatmentsAll: () => ['ect-treatments'] as const,
  assessments: (patientId: string, assessTab?: string) =>
    assessTab ? ['ect-assessments', patientId, assessTab] as const : ['ect-assessments', patientId] as const,
  assessmentsAll: () => ['ect-assessments'] as const,
  consent: () => ['ect-consent'] as const,
  documents: (patientId?: string) => patientId ? ['ect-documents', patientId] as const : ['ect-documents'] as const,
  prescription: () => ['ect-prescription'] as const,
} as const;

// ─── TMS ─────────────────────────────────────────────────────────────────
export const tmsKeys = {
  courses: (patientId: string) => ['tms-courses', patientId] as const,
  coursesAll: () => ['tms-courses'] as const,
  sessions: (patientId: string) => ['tms-sessions', patientId] as const,
  sessionsAll: () => ['tms-sessions'] as const,
  consent: (patientId?: string) => patientId ? ['tms-consent', patientId] as const : ['tms-consent'] as const,
  consentAll: () => ['tms-consent'] as const,
  prescription: (patientId?: string) => patientId ? ['tms-prescription', patientId] as const : ['tms-prescription'] as const,
  prescriptionAll: () => ['tms-prescription'] as const,
} as const;

// ─── Viva (patient app) ──────────────────────────────────────────────────
export const vivaKeys = {
  profileAlerts: (patientId: string) => ['viva-profile-alerts', patientId] as const,
  assessments: (patientId: string) => ['viva-assessments', patientId] as const,
  checklists: (patientId: string) => ['viva-checklists', patientId] as const,
  docs: (patientId: string) => ['viva-docs', patientId] as const,
  invite: (patientId: string) => ['viva-invite', patientId] as const,
  patientTasks: (patientId: string) => ['viva-patient-tasks', patientId] as const,
  reminders: (patientId: string) => ['viva-reminders', patientId] as const,
  thresholdCheck: (patientId: string) => ['viva-threshold-check', patientId] as const,
  thresholds: (patientId: string) => ['viva-thresholds', patientId] as const,
  tracking: (patientId: string) => ['viva-tracking', patientId] as const,
  trackingByType: (patientId: string, type: string) =>
    ['viva-tracking', patientId, type] as const,
  trackingDiary: (patientId: string) => ['viva-tracking', patientId, 'diary'] as const,
  trackingGoal: (patientId: string) => ['viva-tracking', patientId, 'goal'] as const,
  trackingActivity: (patientId: string) => ['viva-tracking', patientId, 'activity'] as const,
  trackingProfile: (patientId: string) => ['viva-tracking', patientId, 'profile'] as const,
} as const;

// ─── Zitavi (patient app gateway) ────────────────────────────────────────
export const zitaviKeys = {
  root: () => ['zitavi'] as const,
  search: (firstName: string, lastName: string) =>
    ['zitavi', 'search', firstName, lastName] as const,
  summary: (zitaviId: string) => ['zitavi', 'summary', zitaviId] as const,
  alerts: (zitaviId: string) => ['zitavi', 'alerts', zitaviId] as const,
  allergies: (zitaviId: string) => ['zitavi', 'allergies', zitaviId] as const,
  conditions: (zitaviId: string) => ['zitavi', 'conditions', zitaviId] as const,
  weight: (zitaviId: string) => ['zitavi', 'weight', zitaviId] as const,
  heartrate: (zitaviId: string) => ['zitavi', 'heartrate', zitaviId] as const,
  bp: (zitaviId: string) => ['zitavi', 'bp', zitaviId] as const,
  bloodsugar: (zitaviId: string) => ['zitavi', 'bloodsugar', zitaviId] as const,
  temp: (zitaviId: string) => ['zitavi', 'temp', zitaviId] as const,
  abdominal: (zitaviId: string) => ['zitavi', 'abdominal', zitaviId] as const,
  medications: (zitaviId: string) => ['zitavi', 'medications', zitaviId] as const,
  moods: (zitaviId: string) => ['zitavi', 'moods', zitaviId] as const,
  journals: (zitaviId: string) => ['zitavi', 'journals', zitaviId] as const,
  support: (zitaviId: string) => ['zitavi', 'support', zitaviId] as const,
  ratingCats: (zitaviId: string) => ['zitavi', 'rating-cats', zitaviId] as const,
  ratings: (zitaviId: string) => ['zitavi', 'ratings', zitaviId] as const,
} as const;

// ─── Unified contacts + referrals (from patient summary/referrals tabs) ──
export const patientReferralsKeys = {
  referrals: (patientId: string) => ['referrals', patientId] as const,
  unifiedContacts: (patientId: string) => ['unified-contacts', patientId] as const,
} as const;

// ─── Templates (used by patient tabs for lookup) ─────────────────────────
export const patientTemplatesKeys = {
  byType: (templateType: string) => ['templates', templateType] as const,
  ratingScales: () => ['templates', 'rating-scales'] as const,
  allPlans: () => ['templates', 'all-plans'] as const,
} as const;

// ─── Prescription print data ─────────────────────────────────────────────
export const prescriptionKeys = {
  printData: (patientId: string) => ['prescription-print-data', patientId] as const,
  printDataByUser: (userId: string | undefined, patientId: string) =>
    ['prescription-print-data', userId, patientId] as const,
} as const;

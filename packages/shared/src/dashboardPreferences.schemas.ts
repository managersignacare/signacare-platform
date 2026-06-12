import { z } from 'zod';

export const DashboardViewIdSchema = z.enum([
  'my_dashboard',
  'team_dashboard',
  'clinician',
  'nurse',
  'case_manager',
  'receptionist',
  'manager',
]);
export type DashboardViewId = z.infer<typeof DashboardViewIdSchema>;

export const DashboardDensitySchema = z.enum(['compact', 'comfortable']);
export type DashboardDensity = z.infer<typeof DashboardDensitySchema>;

export const DashboardLayoutModeSchema = z.enum([
  'clinical_cockpit',
  'focus_today',
  'operations_command',
]);
export type DashboardLayoutMode = z.infer<typeof DashboardLayoutModeSchema>;

export const DashboardCardSizeSchema = z.enum(['sm', 'md', 'lg']);
export type DashboardCardSize = z.infer<typeof DashboardCardSizeSchema>;

export const DashboardCardCategorySchema = z.enum([
  'safety',
  'today',
  'work',
  'team',
  'governance',
  'operations',
  'financial',
]);
export type DashboardCardCategory = z.infer<typeof DashboardCardCategorySchema>;

export const DashboardCardDefinitionSchema = z.object({
  // @zod-convention-exempt: catalog card ids are stable semantic slugs, not database UUIDs.
  id: z.string().min(1),
  // @zod-convention-exempt: viewId is an enum-backed dashboard option key, not a database UUID.
  viewId: DashboardViewIdSchema,
  label: z.string().min(1),
  description: z.string().min(1),
  category: DashboardCardCategorySchema,
  defaultSize: DashboardCardSizeSchema,
  safetyCritical: z.boolean(),
  defaultEnabled: z.boolean(),
});
export type DashboardCardDefinition = z.infer<typeof DashboardCardDefinitionSchema>;

export const DashboardViewPreferenceSchema = z.object({
  layoutMode: DashboardLayoutModeSchema.default('clinical_cockpit'),
  hiddenCardIds: z.array(z.string().min(1)).default([]),
  cardOrder: z.array(z.string().min(1)).default([]),
});
export type DashboardViewPreference = z.infer<typeof DashboardViewPreferenceSchema>;

const DEFAULT_ENABLED_VIEWS: DashboardViewId[] = [
  'my_dashboard',
  'team_dashboard',
  'clinician',
  'nurse',
  'case_manager',
  'receptionist',
  'manager',
];

export const DashboardPreferencesSchema = z.object({
  version: z.literal(1).default(1),
  density: DashboardDensitySchema.default('comfortable'),
  defaultView: DashboardViewIdSchema.optional(),
  enabledViews: z.array(DashboardViewIdSchema).default(DEFAULT_ENABLED_VIEWS),
  viewPreferences: z.record(DashboardViewIdSchema, DashboardViewPreferenceSchema).default({}),
});
export type DashboardPreferences = z.infer<typeof DashboardPreferencesSchema>;

export const DashboardPreferencesResponseSchema = z.object({
  preferences: DashboardPreferencesSchema,
  catalog: z.array(DashboardCardDefinitionSchema),
});
export type DashboardPreferencesResponse = z.infer<typeof DashboardPreferencesResponseSchema>;

export const DashboardPreferencesUpdateSchema = DashboardPreferencesSchema.partial()
  .extend({
    version: z.literal(1).optional(),
    viewPreferences: z.record(DashboardViewIdSchema, DashboardViewPreferenceSchema).optional(),
  });
export type DashboardPreferencesUpdate = z.infer<typeof DashboardPreferencesUpdateSchema>;

export const DASHBOARD_CARD_CATALOG = [
  ['my-next-unsafe-thing', 'my_dashboard', 'Next Unsafe Thing', 'Highest-consequence item for the clinician to resolve next.', 'safety', 'lg', true, true],
  ['my-snapshot', 'my_dashboard', 'My Snapshot', 'Today-oriented workload totals for patients, appointments, tasks, and messages.', 'today', 'lg', true, true],
  ['my-clinical-signals', 'my_dashboard', 'Clinical Signals', 'Safety and monitoring deadlines across the clinician workload.', 'safety', 'lg', true, true],
  ['my-upcoming-appointments', 'my_dashboard', 'Upcoming Appointments', 'Upcoming patient contacts and session context.', 'today', 'md', false, true],
  ['my-task-list', 'my_dashboard', 'Task List', 'Open tasks owned by the current user.', 'work', 'md', false, true],
  ['clinician-signals', 'clinician', 'Clinician Signals', 'Clinical action counters for a clinician view.', 'safety', 'lg', true, true],
  ['clinician-alert-feed', 'clinician', 'Clinical Alert Feed', 'Patient-specific overdue and upcoming clinical alerts.', 'safety', 'md', true, true],
  ['nurse-signals', 'nurse', 'Nursing Clinical Signals', 'Nursing-facing clinical safety counters.', 'safety', 'lg', true, true],
  ['nurse-tasks', 'nurse', 'Nursing Tasks', 'Observation, assessment, and open-task summary for nursing work.', 'work', 'md', false, true],
  ['handover', 'nurse', 'Shift Handover Summary', 'Escalated observations, missed medications, incidents, and admissions.', 'safety', 'md', true, true],
  ['case_manager-signals', 'case_manager', 'Case Manager Clinical Signals', 'Case-manager-facing clinical safety counters.', 'safety', 'lg', true, true],
  ['caseload', 'case_manager', 'My Caseload', 'RAG-state caseload list for care coordination.', 'work', 'md', false, true],
  ['team-command-queue', 'team_dashboard', 'Team Command Queue', 'Acuity-weighted service queue with consequences and next actions.', 'safety', 'lg', true, true],
  ['team-summary', 'team_dashboard', 'Team Safety Summary', 'Team-level clinical signal counters.', 'safety', 'lg', true, true],
  ['team-caseload-operational', 'team_dashboard', 'Caseload & Throughput', 'Active patients, open episodes, appointments, and tasks.', 'operations', 'md', false, true],
  ['team-breakdown', 'team_dashboard', 'Team Breakdown', 'Active patients and episodes by team.', 'team', 'md', false, true],
  ['team-clinician-breakdown', 'team_dashboard', 'Clinician Workload', 'Active patients and episodes by clinician.', 'team', 'md', false, true],
  ['reception-today', 'receptionist', "Today's Schedule", 'Front-desk appointment status summary.', 'today', 'md', true, true],
  ['phone-triage', 'receptionist', 'Open Triage', 'Open phone triage items requiring reception follow-up.', 'work', 'md', false, true],
  ['manager-command-queue', 'manager', 'Manager Command Queue', 'Governance queue showing consequence, owner, SLA, and next action.', 'safety', 'lg', true, true],
  ['manager-service-signals', 'manager', 'Clinic Service Signals', 'Clinic-wide clinical safety counters.', 'safety', 'lg', true, true],
  ['contacts-kpi', 'manager', 'Contacts KPI', 'Contacts target completion by clinician.', 'governance', 'md', false, true],
  ['staff-caseload', 'manager', 'Staff Caseload', 'Caseload pressure by clinician.', 'team', 'md', false, true],
  ['dna-rates', 'manager', 'DNA Rates', 'Did-not-attend rate by clinician.', 'operations', 'sm', false, true],
  ['workload', 'manager', 'Workload Alerts', 'Caseload and overdue-contact workload breaches.', 'safety', 'sm', true, true],
  ['stats', 'manager', 'Service Statistics', 'Referral SLA, appointment, and service-throughput metrics.', 'operations', 'md', false, true],
  ['billing', 'manager', 'Billing', 'Billing and collection summary.', 'financial', 'sm', false, false],
  ['staff', 'manager', 'Staff Activity', 'Appointments, signed notes, and overdue tasks by staff member.', 'governance', 'md', false, true],
].map(([id, viewId, label, description, category, defaultSize, safetyCritical, defaultEnabled]) => ({
  id,
  viewId,
  label,
  description,
  category,
  defaultSize,
  safetyCritical,
  defaultEnabled,
})) as DashboardCardDefinition[];

export const DEFAULT_DASHBOARD_PREFERENCES: DashboardPreferences = {
  version: 1,
  density: 'comfortable',
  enabledViews: DEFAULT_ENABLED_VIEWS,
  viewPreferences: {},
};

const CARD_BY_ID = new Map(DASHBOARD_CARD_CATALOG.map((card) => [card.id, card]));

export function isSafetyCriticalDashboardCard(cardId: string): boolean {
  return CARD_BY_ID.get(cardId)?.safetyCritical === true;
}

export function getDashboardCardsForView(viewId: DashboardViewId): DashboardCardDefinition[] {
  return DASHBOARD_CARD_CATALOG.filter((card) => card.viewId === viewId);
}

export function normalizeDashboardPreferences(input: unknown): DashboardPreferences {
  const parsed = DashboardPreferencesSchema.safeParse(input);
  const source = parsed.success ? parsed.data : DEFAULT_DASHBOARD_PREFERENCES;
  const next: DashboardPreferences = {
    ...DEFAULT_DASHBOARD_PREFERENCES,
    ...source,
    version: 1,
    enabledViews: [...new Set(source.enabledViews ?? DEFAULT_ENABLED_VIEWS)]
      .filter((viewId) => DashboardViewIdSchema.safeParse(viewId).success),
    viewPreferences: {},
  };
  if (next.enabledViews.length === 0) {
    next.enabledViews = [...DEFAULT_ENABLED_VIEWS];
  }
  if (next.defaultView && !next.enabledViews.includes(next.defaultView)) {
    next.defaultView = next.enabledViews[0];
  }

  for (const viewId of DashboardViewIdSchema.options) {
    const view = source.viewPreferences?.[viewId];
    if (!view) continue;
    const allowedCardIds = new Set(getDashboardCardsForView(viewId).map((card) => card.id));
    next.viewPreferences[viewId] = {
      layoutMode: view.layoutMode ?? 'clinical_cockpit',
      hiddenCardIds: [...new Set(view.hiddenCardIds ?? [])]
        .filter((cardId) => allowedCardIds.has(cardId))
        .filter((cardId) => !isSafetyCriticalDashboardCard(cardId)),
      cardOrder: [...new Set(view.cardOrder ?? [])]
        .filter((cardId) => allowedCardIds.has(cardId)),
    };
  }

  return DashboardPreferencesSchema.parse(next);
}

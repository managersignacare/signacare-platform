export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

// Clinic-wide analytics tools are high-sensitivity because they expose
// organisation-level patient/legal metrics beyond a single patient context.
export const CLINIC_WIDE_MCP_TOOLS = new Set<string>([
  'org_statistics',
  'team_caseload',
  'staff_workload',
  'list_staff',
  'overdue_reviews',
  'referral_metrics',
  'appointment_metrics',
  'clinical_activity',
  'bed_occupancy',
  'discharge_metrics',
  'waitlist_metrics',
  'medication_metrics',
  'risk_overview',
  'task_metrics',
]);

// Non-DB tools must bypass per-tool RLS transaction wrapping.
export const MCP_NON_DB_TOOLS = new Set<string>([
  'generate_clinical_document',
  'classify_text',
  'list_models',
  'search_drug_interactions',
]);

// Tools allowed when AI request scope is narrowed to a specific patient.
// All other tools are blocked in patient scope to prevent accidental
// clinic-wide/team-wide data disclosure.
export const PATIENT_SCOPED_MCP_TOOLS = new Set<string>([
  'get_patient',
  'get_patient_context',
  'list_medications',
  'list_notes',
  'create_note',
  'list_alerts',
  'list_episodes',
  'list_legal_orders',
]);

export const MCP_TOOLS: McpToolDef[] = [
  { name: 'search_patients', description: 'Search patients by name, UR number, or DOB.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search term' }, limit: { type: 'string', description: 'Max results (default 10)' } }, required: ['query'] } },
  { name: 'get_patient', description: 'Get patient demographics.',
    inputSchema: { type: 'object', properties: { patientId: { type: 'string', description: 'Patient UUID' } }, required: ['patientId'] } },
  { name: 'get_patient_context', description: 'Full clinical context: demographics, episodes, meds, alerts, notes, legal. For RAG.',
    inputSchema: { type: 'object', properties: { patientId: { type: 'string', description: 'Patient UUID' }, clinicId: { type: 'string', description: 'Clinic UUID' } }, required: ['patientId', 'clinicId'] } },
  { name: 'list_medications', description: 'List medications. Filter by status.',
    inputSchema: { type: 'object', properties: { patientId: { type: 'string', description: 'Patient UUID' }, status: { type: 'string', description: 'active|ceased|tapering|all' } }, required: ['patientId'] } },
  { name: 'list_notes', description: 'List clinical notes with content preview.',
    inputSchema: { type: 'object', properties: { patientId: { type: 'string', description: 'Patient UUID' }, limit: { type: 'string', description: 'Max results' } }, required: ['patientId'] } },
  { name: 'create_note', description: 'Create a draft clinical note.',
    inputSchema: { type: 'object', properties: { patientId: { type: 'string', description: 'Patient UUID' }, clinicId: { type: 'string', description: 'Clinic UUID' }, authorId: { type: 'string', description: 'Staff UUID' }, category: { type: 'string', description: 'Note category' }, content: { type: 'string', description: 'HTML content' } }, required: ['patientId', 'clinicId', 'content'] } },
  { name: 'list_alerts', description: 'Active alerts/flags for a patient.',
    inputSchema: { type: 'object', properties: { patientId: { type: 'string', description: 'Patient UUID' } }, required: ['patientId'] } },
  { name: 'generate_clinical_document', description: 'Generate clinical document via local AI: maudsley, isbar, formulation, 91day, letter, discharge, med-summary, ambient.',
    inputSchema: { type: 'object', properties: { action: { type: 'string', description: 'Document type' }, data: { type: 'string', description: 'Input data' }, model: { type: 'string', description: 'LLM model' } }, required: ['action', 'data'] } },
  { name: 'classify_text', description: 'Classify clinical text: sentiment, risk, PHQ/GAD estimates.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'Text to classify' } }, required: ['text'] } },
  { name: 'list_models', description: 'List available LLM models.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'search_drug_interactions', description: 'Check drug interactions via NLM RxNorm.',
    inputSchema: { type: 'object', properties: { drugs: { type: 'string', description: 'Comma-separated drug names' } }, required: ['drugs'] } },
  { name: 'list_episodes', description: 'List episodes of care.',
    inputSchema: { type: 'object', properties: { patientId: { type: 'string', description: 'Patient UUID' }, status: { type: 'string', description: 'open|closed|all' } }, required: ['patientId'] } },
  { name: 'team_caseload', description: 'Get caseload summary for a team/unit: patient count, active episodes, upcoming reviews.',
    inputSchema: { type: 'object', properties: { team: { type: 'string', description: 'Team or unit name as configured in this organisation' } }, required: ['team'] } },
  { name: 'org_statistics', description: 'Organisation-wide statistics: total patients, episodes, staff, medication counts, alerts.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'staff_workload', description: 'Get workload for a specific staff member: patient count, upcoming appointments, pending notes.',
    inputSchema: { type: 'object', properties: { staffId: { type: 'string', description: 'Staff UUID (or name to search)' } }, required: ['staffId'] } },
  { name: 'list_staff', description: 'List all staff with role, discipline.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'overdue_reviews', description: 'List patients with overdue 91-day reviews or MHA order reviews.',
    inputSchema: { type: 'object', properties: { team: { type: 'string', description: 'Optional team filter' } } } },
  { name: 'list_legal_orders', description: 'List active/pending MHA legal orders, optionally filtered by patient.',
    inputSchema: { type: 'object', properties: { patientId: { type: 'string', description: 'Optional patient filter' } } } },
  { name: 'referral_metrics', description: 'Referral intake metrics: total received, accepted, declined, pending, SLA compliance, avg days to first contact.',
    inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'today|week|month|quarter|year (default month)' }, team: { type: 'string', description: 'Optional team filter' } } } },
  { name: 'appointment_metrics', description: 'Appointment metrics: total scheduled, completed, DNA/no-show rate, cancellation rate, telehealth %.',
    inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'today|week|month|quarter|year' }, team: { type: 'string', description: 'Optional team filter' } } } },
  { name: 'clinical_activity', description: 'ABF clinical contact activity: notes written, signed, unsigned/draft, notes per clinician, reportable contacts.',
    inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'today|week|month|quarter|year' }, team: { type: 'string', description: 'Optional team filter' } } } },
  { name: 'bed_occupancy', description: 'Inpatient bed occupancy: total beds, occupied, available, avg length of stay.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'discharge_metrics', description: 'Discharge metrics: episodes closed this period, avg length of episode, discharge reasons breakdown.',
    inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'today|week|month|quarter|year' }, team: { type: 'string', description: 'Optional team filter' } } } },
  { name: 'waitlist_metrics', description: 'Waitlist metrics: total waiting, avg wait time, longest waiting, by urgency.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'medication_metrics', description: 'Medication metrics: total active, clozapine patients, LAI patients, S8 prescriptions, polypharmacy count.',
    inputSchema: { type: 'object', properties: { team: { type: 'string', description: 'Optional team filter' } } } },
  { name: 'risk_overview', description: 'Risk overview: patients at high/very high risk, recent risk assessments, unassessed patients.',
    inputSchema: { type: 'object', properties: { team: { type: 'string', description: 'Optional team filter' } } } },
  { name: 'task_metrics', description: 'Task metrics: open tasks, overdue tasks, completed this period, by assignee.',
    inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'today|week|month|quarter|year' }, team: { type: 'string', description: 'Optional team filter' } } } },
];

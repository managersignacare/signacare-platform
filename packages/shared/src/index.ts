export * from "./luhn";
export * from "./rbac.schemas";
export * from "./auth.schemas";
export * from "./authContext";
export * from "./permissions";
export * from "./domainCommands";
export * from "./pagination";
export * from "./apiEnvelope.schemas";
export * from "./patient.schemas";
export * from "./patientSummarySignoff.schemas";
export * from "./billing.schemas";
export * from "./correspondence.schemas";
export * from "./clinic.schemas";
export * from "./staff.schemas";
export * from "./hiService.schemas";
export * from './referralSchemas';
export * from './risk.schemas';
export * from './flag.schemas';
export * from './allergy.schemas';
export * from './schemas/clinicalNote.schema';
export * from './schemas/template.schema';
export * from './schemas/escalation.schema';
export * from './medication.schemas';
export * from './prescription.schemas';
export * from './lai.schemas';
export * from './clozapine.schemas';
export * from './sideEffectSchedule.schemas';
export * from './medicationAdministration.schemas';
export * from './dashboard.schemas';
export * from './voice.schemas';
export * from './llm.schemas';
export * from './modelRouter.schemas';
export * from './agenticScribe.schemas';
export * from './aiScribeParity.schemas';
export * from './llmPromptProfiles.schemas';
export * from './scribeMseStructured.schemas';
export * from './clinicalReview.schemas';
export * from './report.schemas';
export * from './adminReport.schemas';
export * from './safeScript.schemas';
export * from './episode.schemas';
export * from './appointment.Schemas';
export * from './task.schemas';
export * from './message.schemas';
export * from './settings.schemas';
export * from './pathology.schemas';
export * from './powerSettings.schemas';
export * from './orgSettings.schemas';
export * from './staffSettings.schemas';
export * from './provisioning.schemas';
export * from './specialty.schemas';
export * from './moduleRegistry';
export * from './problemList.schemas';
export * from './medicationReconciliation.schemas';
export * from './endocrinology.schemas';
export * from './paediatrics.schemas';
export * from './obsGyne.schemas';
export * from './surgery.schemas';
export * from './oncology.schemas';
export * from './notification.schemas';
export * from './patientOutreach.schemas';
export * from './calendar.Schemas';
export * from './advanceDirective.Schemas';
export * from './legalOrder.Schemas';
export * from './clinicalNote.Schemas';
export * from './patientClinicalIntelligence.schemas';
export * from './postDeployHardening.schemas';
export * from './admissionWaitlist.Schemas';
export * from './bed.Schemas';
export * from './groupTherapy.Schemas';
export * from './carer.Schemas';
export * from './checklist.Schemas';
export * from './ereferral.Schemas';
export * from './treatmentPathway.Schemas';
export * from './digitalCarePathway.schemas';
export * from './behavioralPathway.schemas';
export * from './featureFlag.Schemas';
export * from './featureFlag.constants';
export * from './laiValidation.Schemas';
export * from './outcome.Schemas'
export * from './staffSettingsAdmin.Schemas'
export * from './contactRecord.Schemas';
export * from './au_reference_data'
export * from './generated/openapi';

// BUG-530 — UIStatus + Result canonical SSoT (Phase A item 5).
export * from './errors/appError';
export * from './errors/result';
export * from './ui/statusMachine';

// PART 23 — Clinical Context Orchestrator contract foundation (slice 1).
export * from './clinicalContext.schemas';
export * from './clinicalAiAsync.schemas';

// Phase 7 — ASR (Whisper) backend selection contract.
export * from './whisperBackend.schemas';

// Phase 8 — Assessment taxonomy SSoT (outcome measures vs rating scales,
// rater type, diagnosis category).
export * from './assessmentTaxonomy';

// Phase 8 — Assessment visualisation contract (latest-score / trend /
// cross-instrument summary read shape for the OutcomeMeasures + Rating
// Scales + Viva tabs).
export * from './assessmentVisualization.schemas';

// Phase 8 — Per-instrument scoring metadata (max / min raw score, severity
// bands). Used by the visualisation contract for severity chips + max-score
// references; consumed by both the backend aggregation endpoint and the
// frontend chart components.
export * from './assessmentScoring';

// Drawing payload — SSoT for the stored shape of cognitive-scale drawing
// items (MMSE pentagons, MoCA cube/clock). Consumed by the web canvas
// renderer, the API template-form save path, the chronology playback,
// and the .NET split-platform parity.
export * from './drawingPayload';

// Drawing analytics — pure-logic metrics (stroke count, cumulative
// stroke-duration, pressure summary, bounding box, canvas coverage)
// derived from a stored DrawingPayload. Consumed by the
// AssessmentsTab read-back metrics strip and by any future analytics
// surface that needs to characterise a captured drawing without
// re-rendering the strokes.
export * from './drawingAnalytics';
export * from './systemRoles';
export * from './patientDutyRelationship';

// Dashboard options — additive cockpit dashboards + user preference
// contract. The existing /dashboard remains unchanged; these schemas
// govern selectable dashboard variants and safety-critical widget locks.
export * from './dashboardPreferences.schemas';

// Phase 9 — model shadow-mode governance + promotion safety contracts.
export * from './aiModelGovernance.schemas';

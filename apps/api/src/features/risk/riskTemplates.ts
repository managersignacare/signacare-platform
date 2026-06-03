// apps/api/src/features/risk/riskTemplates.ts
//
// Static catalog of clinician-rated risk assessment templates. These
// are frontend-facing structured assessment scaffolds (sections →
// items → min/max) used by apps/web/src/features/risk-allergies/
// components/RiskAssessmentForm.tsx to render the structured form.
//
// Audit 2026-04-16 L3 follow-up: the GET /risk-assessments/templates
// and GET /risk-assessments/templates/:templateId endpoints the
// frontend was calling had NO backend handler. The frontend received
// 404s, the form rendered empty, and no new structured risk
// assessments could be created via this flow. This module is the
// backend fix — three canonical templates covering the three most
// common clinical risk domains: suicide, self-harm, and harm to
// others. Scoring follows the frontend's `scoreToRiskLevel` helper
// (< 25% → low, < 50% → medium, < 75% → high, ≥ 75% → very_high).
//
// The catalog is static because risk templates are a clinical
// reference dataset, not tenant-specific configuration. A future
// phase can migrate this into a `risk_templates` table keyed on
// clinic_id if any clinic asks for customisation, and this module
// becomes the seed data.

export interface RiskTemplateItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly minValue: number;
  readonly maxValue: number;
}

export interface RiskTemplateSection {
  readonly id: string;
  readonly label: string;
  readonly items: readonly RiskTemplateItem[];
  readonly maxScore: number;
}

export interface RiskTemplate {
  readonly id: string;
  readonly name: string;
  readonly sections: readonly RiskTemplateSection[];
  readonly totalMax: number;
}

function sumSections(sections: readonly RiskTemplateSection[]): number {
  return sections.reduce((acc, s) => acc + s.maxScore, 0);
}

function sumItems(items: readonly RiskTemplateItem[]): number {
  return items.reduce((acc, i) => acc + i.maxValue, 0);
}

// ── Suicide Risk Assessment (SRA) ────────────────────────────────

const SRA_IDEATION: RiskTemplateSection = {
  id: 'sra.ideation',
  label: 'Ideation',
  items: [
    { id: 'sra.ideation.current', label: 'Current ideation', description: 'Frequency and intensity of current suicidal ideation', minValue: 0, maxValue: 4 },
    { id: 'sra.ideation.plan', label: 'Plan formation', description: 'Specificity of plan (vague → detailed with means + time)', minValue: 0, maxValue: 4 },
    { id: 'sra.ideation.intent', label: 'Stated intent', description: 'Expressed intent to act (none → strong stated intent)', minValue: 0, maxValue: 4 },
  ],
  get maxScore() { return sumItems(this.items); },
};

const SRA_HISTORY: RiskTemplateSection = {
  id: 'sra.history',
  label: 'Historical factors',
  items: [
    { id: 'sra.history.attempts', label: 'Previous attempts', description: 'Number + lethality of previous suicide attempts', minValue: 0, maxValue: 4 },
    { id: 'sra.history.family', label: 'Family history', description: 'Family history of completed suicide', minValue: 0, maxValue: 2 },
    { id: 'sra.history.hospitalisation', label: 'Prior psych admission', description: 'Admissions for self-harm or suicide attempts', minValue: 0, maxValue: 2 },
  ],
  get maxScore() { return sumItems(this.items); },
};

const SRA_CURRENT: RiskTemplateSection = {
  id: 'sra.current',
  label: 'Current clinical state',
  items: [
    { id: 'sra.current.mood', label: 'Mood severity', description: 'Severity of depression / hopelessness', minValue: 0, maxValue: 4 },
    { id: 'sra.current.psychotic', label: 'Psychotic symptoms', description: 'Command hallucinations or delusions driving self-harm', minValue: 0, maxValue: 4 },
    { id: 'sra.current.substance', label: 'Substance use', description: 'Current intoxication or disinhibition', minValue: 0, maxValue: 3 },
  ],
  get maxScore() { return sumItems(this.items); },
};

const SUICIDE_RISK_TEMPLATE: RiskTemplate = {
  id: 'suicide-risk',
  name: 'Suicide Risk Assessment',
  sections: [SRA_IDEATION, SRA_HISTORY, SRA_CURRENT],
  get totalMax() { return sumSections(this.sections); },
};

// ── Self-harm Risk Assessment ────────────────────────────────────

const SHR_CURRENT: RiskTemplateSection = {
  id: 'shr.current',
  label: 'Current self-harm behaviour',
  items: [
    { id: 'shr.current.frequency', label: 'Frequency', description: 'Episodes in the last 30 days', minValue: 0, maxValue: 4 },
    { id: 'shr.current.lethality', label: 'Lethality', description: 'Method lethality (superficial → high lethality)', minValue: 0, maxValue: 4 },
    { id: 'shr.current.concealment', label: 'Concealment', description: 'Hiding behaviour from treating team and family', minValue: 0, maxValue: 3 },
  ],
  get maxScore() { return sumItems(this.items); },
};

const SHR_TRIGGERS: RiskTemplateSection = {
  id: 'shr.triggers',
  label: 'Triggers and protective factors',
  items: [
    { id: 'shr.triggers.interpersonal', label: 'Interpersonal triggers', description: 'Conflict / rejection / loss sensitivity', minValue: 0, maxValue: 3 },
    { id: 'shr.triggers.regulation', label: 'Emotion regulation', description: 'Ability to self-regulate without self-harm', minValue: 0, maxValue: 4 },
    { id: 'shr.triggers.support', label: 'Social support', description: 'Availability of protective social support', minValue: 0, maxValue: 2 },
  ],
  get maxScore() { return sumItems(this.items); },
};

const SELF_HARM_TEMPLATE: RiskTemplate = {
  id: 'self-harm',
  name: 'Self-harm Risk Assessment',
  sections: [SHR_CURRENT, SHR_TRIGGERS],
  get totalMax() { return sumSections(this.sections); },
};

// ── Violence / Harm-to-others Risk Assessment ────────────────────

const VHR_HISTORY: RiskTemplateSection = {
  id: 'vhr.history',
  label: 'Historical factors',
  items: [
    { id: 'vhr.history.violence', label: 'Previous violence', description: 'Documented previous violent incidents', minValue: 0, maxValue: 4 },
    { id: 'vhr.history.weapons', label: 'Weapon access', description: 'Access to weapons or improvised weapons', minValue: 0, maxValue: 4 },
    { id: 'vhr.history.legal', label: 'Forensic history', description: 'Prior criminal convictions involving violence', minValue: 0, maxValue: 3 },
  ],
  get maxScore() { return sumItems(this.items); },
};

const VHR_CURRENT: RiskTemplateSection = {
  id: 'vhr.current',
  label: 'Current state',
  items: [
    { id: 'vhr.current.threats', label: 'Active threats', description: 'Specific threats made to identifiable targets', minValue: 0, maxValue: 4 },
    { id: 'vhr.current.arousal', label: 'Arousal / agitation', description: 'Observable agitation, pacing, verbal escalation', minValue: 0, maxValue: 4 },
    { id: 'vhr.current.substance', label: 'Substance disinhibition', description: 'Current intoxication lowering threshold for aggression', minValue: 0, maxValue: 3 },
  ],
  get maxScore() { return sumItems(this.items); },
};

const VIOLENCE_RISK_TEMPLATE: RiskTemplate = {
  id: 'harm-to-others',
  name: 'Harm-to-others Risk Assessment',
  sections: [VHR_HISTORY, VHR_CURRENT],
  get totalMax() { return sumSections(this.sections); },
};

// ── Catalog + helpers ────────────────────────────────────────────

const CATALOG: readonly RiskTemplate[] = [
  SUICIDE_RISK_TEMPLATE,
  SELF_HARM_TEMPLATE,
  VIOLENCE_RISK_TEMPLATE,
];

// Deep-clone on read so the getter-based maxScore/totalMax are
// materialized into plain numbers (JSON serialization of a getter
// emits the computed value, but explicit materialization keeps
// consumers honest and makes unit tests trivially assertable).
function materialize(tpl: RiskTemplate): RiskTemplate {
  return {
    id: tpl.id,
    name: tpl.name,
    sections: tpl.sections.map((s) => ({
      id: s.id,
      label: s.label,
      items: s.items.map((i) => ({ ...i })),
      maxScore: s.maxScore,
    })),
    totalMax: tpl.totalMax,
  };
}

export function listRiskTemplates(): RiskTemplate[] {
  return CATALOG.map(materialize);
}

export function getRiskTemplate(templateId: string): RiskTemplate | null {
  const hit = CATALOG.find((t) => t.id === templateId);
  return hit ? materialize(hit) : null;
}

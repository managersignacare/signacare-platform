import { templateRepository } from './template.repository';

type TemplateSeed = {
  name: string;
  description: string;
  sections: Array<{
    label: string;
    fieldType:
      | 'text'
      | 'yes_no'
      | 'single_select'
      | 'multi_select'
      | 'likert'
      | 'numeric'
      | 'date'
      | 'heading';
    soapField?: 'subjective' | 'objective' | 'assessment' | 'plan' | null;
    required?: boolean;
    options?: Array<{ label: string; value: string; score?: number }>;
    minValue?: number | null;
    maxValue?: number | null;
    placeholder?: string | null;
  }>;
};

const CLINICAL_NOTES_CATEGORY = 'Clinical Notes';

const DEFAULT_CLINICAL_NOTE_TEMPLATES: TemplateSeed[] = [
  {
    name: 'Progress Note (Mental Health)',
    description:
      'Standard Australian mental-health progress note using a SOAP frame plus risk, leave, and follow-up actions.',
    sections: [
      { label: 'Progress Note', fieldType: 'heading' },
      { label: 'Subjective', fieldType: 'text', soapField: 'subjective', required: true, placeholder: 'Consumer report, concerns, goals, and lived-experience context' },
      { label: 'Objective', fieldType: 'text', soapField: 'objective', required: true, placeholder: 'Presentation, MSE, observations, physical health, engagement' },
      { label: 'Assessment', fieldType: 'text', soapField: 'assessment', required: true, placeholder: 'Diagnostic impression, progress since last review, response to treatment' },
      { label: 'Plan', fieldType: 'text', soapField: 'plan', required: true, placeholder: 'Medication, review timing, referrals, leave, legal, family / GP liaison' },
      { label: 'Current risk concerns', fieldType: 'text', placeholder: 'Suicide, self-harm, aggression, vulnerability, absconding, neglect' },
      { label: 'Change to observation level or leave?', fieldType: 'yes_no' },
      { label: 'Follow-up owner and timeframe', fieldType: 'text', placeholder: 'Who is doing what by when' },
    ],
  },
  {
    name: 'Initial Assessment (Mental Health)',
    description:
      'Initial psychiatric / mental-health assessment structure for Australian community and inpatient workflows.',
    sections: [
      { label: 'Initial Mental Health Assessment', fieldType: 'heading' },
      { label: 'Referral source and reason for assessment', fieldType: 'text', required: true },
      { label: 'History of presenting complaint', fieldType: 'text', required: true },
      { label: 'Past psychiatric history', fieldType: 'text' },
      { label: 'Medical history and medications', fieldType: 'text' },
      { label: 'Alcohol and other drug history', fieldType: 'text' },
      { label: 'Personal, developmental, trauma, and social history', fieldType: 'text' },
      { label: 'Family / carer context', fieldType: 'text', placeholder: 'Family psychiatric history, supports, children, caring responsibilities' },
      { label: 'Mental state examination', fieldType: 'text', required: true },
      { label: 'Risk assessment', fieldType: 'text', required: true },
      { label: 'Protective factors', fieldType: 'text' },
      { label: 'Formulation', fieldType: 'text', placeholder: '4P or biopsychosocial formulation' },
      { label: 'Provisional diagnosis', fieldType: 'text' },
      { label: 'Management plan', fieldType: 'text', required: true },
    ],
  },
  {
    name: 'Family Meeting Note',
    description:
      'Family / carer meeting note with consent, concerns raised, agreed actions, and follow-up responsibilities.',
    sections: [
      { label: 'Family / Carer Meeting', fieldType: 'heading' },
      { label: 'Participants', fieldType: 'text', required: true },
      { label: 'Consumer present?', fieldType: 'yes_no' },
      { label: 'Consent / confidentiality boundaries discussed', fieldType: 'text', required: true },
      { label: 'Key concerns raised', fieldType: 'text', required: true },
      { label: 'Information provided to family / carers', fieldType: 'text' },
      { label: 'Risk issues discussed', fieldType: 'text' },
      { label: 'Agreed actions and responsibilities', fieldType: 'text', required: true },
      { label: 'Next review / follow-up', fieldType: 'text' },
    ],
  },
  {
    name: 'Medication Review Note',
    description:
      'Psychotropic medication review template covering efficacy, adverse effects, monitoring, and shared decision-making.',
    sections: [
      { label: 'Medication Review', fieldType: 'heading' },
      { label: 'Indication for review', fieldType: 'text', required: true },
      { label: 'Current psychotropic and non-psychotropic medications', fieldType: 'text', required: true },
      { label: 'Response to current regimen', fieldType: 'text' },
      { label: 'Adverse effects and tolerability', fieldType: 'text' },
      { label: 'Physical health / monitoring results', fieldType: 'text', placeholder: 'Weight, BP, ECG, glucose, lipids, prolactin, clozapine, LAI, etc.' },
      { label: 'Adherence and consumer preferences', fieldType: 'text' },
      { label: 'Medication changes made', fieldType: 'text' },
      { label: 'Education, consent, and follow-up plan', fieldType: 'text', required: true },
    ],
  },
  {
    name: 'Risk Assessment Review',
    description:
      'Structured suicide, self-harm, aggression, vulnerability, and absconding risk review for Australian mental-health settings.',
    sections: [
      { label: 'Risk Assessment Review', fieldType: 'heading' },
      { label: 'Triggers / current stressors', fieldType: 'text' },
      { label: 'Suicide or self-harm risk', fieldType: 'text', required: true },
      { label: 'Violence / aggression risk', fieldType: 'text' },
      { label: 'Vulnerability / exploitation risk', fieldType: 'text' },
      { label: 'Absconding / disengagement risk', fieldType: 'text' },
      { label: 'Overall risk level', fieldType: 'single_select', options: [
        { label: 'Low', value: 'low' },
        { label: 'Moderate', value: 'moderate' },
        { label: 'High', value: 'high' },
        { label: 'Extreme', value: 'extreme' },
      ] },
      { label: 'Protective factors', fieldType: 'text' },
      { label: 'Immediate safety actions', fieldType: 'text', required: true },
      { label: 'Who has been informed?', fieldType: 'text', placeholder: 'Family / carers, GP, consultant psychiatrist, team, AMHS / CAT, police if applicable' },
    ],
  },
];

export async function ensureDefaultClinicalNoteTemplates(
  clinicId: string,
  createdById: string,
): Promise<void> {
  const category = await templateRepository.findCategoryByName(
    clinicId,
    CLINICAL_NOTES_CATEGORY,
  );

  if (!category) {
    await templateRepository.createCategory(clinicId, CLINICAL_NOTES_CATEGORY);
  }

  const existing = await templateRepository.list(clinicId, {
    category: CLINICAL_NOTES_CATEGORY,
  });
  const existingNames = new Set(existing.map((template) => template.name));

  for (const seed of DEFAULT_CLINICAL_NOTE_TEMPLATES) {
    if (existingNames.has(seed.name)) {
      continue;
    }

    const created = await templateRepository.create(clinicId, createdById, {
      name: seed.name,
      description: seed.description,
      category: CLINICAL_NOTES_CATEGORY,
      sections: seed.sections.map((section, index) => ({
        label: section.label,
        fieldType: section.fieldType,
        soapField: section.soapField ?? null,
        required: section.required ?? false,
        position: index,
        options: section.options ?? null,
        minValue: section.minValue ?? null,
        maxValue: section.maxValue ?? null,
        placeholder: section.placeholder ?? null,
      })),
    });

    await templateRepository.setStatus(clinicId, created.id, 'published');
  }
}

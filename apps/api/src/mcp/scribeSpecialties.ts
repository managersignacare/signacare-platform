/**
 * Specialty-Specific Scribe Prompts
 *
 * Each specialty has tailored extraction and formatting instructions
 * that understand domain-specific terminology and workflows.
 */

export interface SpecialtyConfig {
  name: string;
  extractionAddendum: string;  // Added to Pass 1 prompt
  formattingAddendum: string;  // Added to Pass 3 prompt
  additionalSections: string[];
  keyTerms: string[];          // Domain vocabulary for better extraction
}

export const SPECIALTY_CONFIGS: Record<string, SpecialtyConfig> = {

  psychiatry: {
    name: 'Adult Psychiatry',
    extractionAddendum: `
PSYCHIATRY-SPECIFIC EXTRACTION:
- Extract ALL MSE domains discussed — use [MSE:domain] tags
- For psychotic symptoms: specify type (persecutory, grandiose, referential), systematisation, conviction
- For mood: differentiate subjective mood (patient's words) from objective affect (your observation)
- For risk: distinguish current ideation from historical, passive from active, plan from intent
- For medications: note metabolic monitoring status (weight, BSL, lipids)
- For involuntary patients: note legal status, treatment order details, tribunal dates
- Extract therapeutic alliance quality observations
- Note any forensic history or legal matters discussed`,
    formattingAddendum: `
PSYCHIATRY-SPECIFIC FORMATTING:
- MSE must include all 11 domains, even if "Not formally assessed"
- Risk assessment must distinguish: risk to self, risk to others, vulnerability, absconding
- Include legal status section for involuntary patients
- Medications section must note metabolic monitoring compliance
- Assessment should include diagnostic formulation (biopsychosocial if intake)
- Plan should specify: medication changes, therapy plan, review timeframe, crisis plan status`,
    additionalSections: ['LEGAL STATUS', 'THERAPEUTIC ALLIANCE', 'FORMULATION'],
    keyTerms: ['psychosis', 'delusion', 'hallucination', 'paranoid', 'grandiose', 'thought disorder',
      'clang association', 'neologism', 'tangential', 'circumstantial', 'flight of ideas',
      'depot', 'LAI', 'clozapine', 'metabolic', 'akathisia', 'tardive', 'EPS',
      'involuntary', 'treatment order', 'community treatment order', 'CTO', 'tribunal',
      'section 29', 'ECT', 'seclusion', 'restraint', 'observation level'],
  },

  'child-adolescent': {
    name: 'Child & Adolescent Psychiatry',
    extractionAddendum: `
CHILD/ADOLESCENT-SPECIFIC EXTRACTION:
- Note developmental milestones and any delays
- Extract school/education information (attendance, performance, bullying)
- Note family dynamics and parenting observations
- For younger children: extract play therapy observations, attachment behaviours
- Note involvement of parents/carers in session — who was present
- Extract HEADSS assessment elements if discussed (Home, Education, Activities, Drugs, Sexuality, Suicide)
- Note any child protection concerns or mandatory reporting triggers
- Extract peer relationships and social functioning`,
    formattingAddendum: `
CHILD/ADOLESCENT-SPECIFIC FORMATTING:
- Include "INFORMANTS" section (who provided information — child, parent, teacher)
- Developmental history section
- Family and social context section
- HEADSS assessment if applicable
- School functioning section
- Observation of parent-child interaction if observed
- Safety plan must be age-appropriate
- Note: For patients under 18, include Gillick competence assessment if relevant`,
    additionalSections: ['INFORMANTS', 'DEVELOPMENTAL CONTEXT', 'SCHOOL/EDUCATION', 'FAMILY DYNAMICS', 'HEADSS'],
    keyTerms: ['developmental', 'milestones', 'attachment', 'separation anxiety', 'school refusal',
      'bullying', 'self-harm', 'cutting', 'social media', 'gaming', 'peer', 'puberty',
      'ADHD', 'autism', 'ASD', 'conduct', 'oppositional', 'enuresis', 'encopresis',
      'Gillick', 'mandatory reporting', 'child protection'],
  },

  'aged-care': {
    name: 'Older Persons Mental Health',
    extractionAddendum: `
OLDER PERSONS-SPECIFIC EXTRACTION:
- Extract cognitive screening results (MMSE, MoCA, ACE-III scores)
- Note functional status (ADLs, IADLs) and changes
- Extract falls history and mobility status
- Note delirium screening (CAM, 4AT) if performed
- Extract carer burden and support needs
- Note residential care details if applicable (RACF, level of care)
- Extract sensory deficits (hearing, vision) affecting assessment
- Note polypharmacy concerns and medication review needs
- Extract capacity assessment details if discussed`,
    formattingAddendum: `
OLDER PERSONS-SPECIFIC FORMATTING:
- Include cognitive screening results with comparison to previous
- Functional assessment section (ADLs, IADLs, mobility)
- Delirium risk assessment
- Falls risk assessment
- Carer/support section
- Capacity assessment if relevant
- Polypharmacy review section
- BPSD management if applicable (behavioural and psychological symptoms of dementia)`,
    additionalSections: ['COGNITIVE SCREENING', 'FUNCTIONAL STATUS', 'DELIRIUM SCREEN', 'CARER ASSESSMENT', 'CAPACITY'],
    keyTerms: ['dementia', 'Alzheimer', 'vascular', 'Lewy body', 'frontotemporal',
      'MMSE', 'MoCA', 'ACE-III', 'CAM', '4AT', 'BPSD', 'wandering', 'sundowning',
      'falls', 'polypharmacy', 'anticholinergic', 'RACF', 'aged care', 'guardian',
      'capacity', 'VCAT', 'enduring power of attorney', 'advance care directive'],
  },

  'emergency': {
    name: 'Emergency / Crisis',
    extractionAddendum: `
EMERGENCY-SPECIFIC EXTRACTION:
- Extract presenting crisis in detail — precipitant, timeline, severity
- Note mode of presentation (self-presented, brought by police, ambulance, family)
- Extract triage category and legal status on arrival
- Note current substance intoxication or withdrawal signs
- For suicidal presentations: method, means, intent, plan, access, prior attempts, timeline
- Note police involvement, ITO, ambulance attendance
- Extract collateral information sources and what they reported
- Note disposition plan (admit, CATT, discharge, transfer)`,
    formattingAddendum: `
EMERGENCY-SPECIFIC FORMATTING:
- Begin with TRIAGE/PRESENTATION section
- Include detailed risk assessment (Columbia-Suicide Severity Rating Scale if applicable)
- Note physical health assessment/medical clearance status
- Include collateral history section
- Legal/police involvement section
- Substance use — current intoxication/withdrawal
- Disposition and safety plan
- Follow-up arrangements and handover plan
- Time-stamped interventions if multiple contacts`,
    additionalSections: ['TRIAGE', 'COLLATERAL HISTORY', 'MEDICAL CLEARANCE', 'DISPOSITION', 'SAFETY PLAN'],
    keyTerms: ['crisis', 'triage', 'Cat 1', 'Cat 2', 'Cat 3', 'ITO', 'police',
      'ambulance', 'Section 351', 'sedation', 'rapid tranquillisation', 'seclusion',
      'CATT', 'crisis team', 'psychiatric emergency', 'medical clearance',
      'disposition', 'voluntary', 'involuntary', 'absconding', 'security'],
  },

  'forensic': {
    name: 'Forensic Psychiatry',
    extractionAddendum: `
FORENSIC-SPECIFIC EXTRACTION:
- Extract legal status and relevant orders (forensic order, supervision order, NCR)
- Note index offence and forensic history
- Extract victim-related concerns and safety requirements
- Note security classification and privilege level
- Extract substance use in context of offending
- Note violence risk assessment factors (HCR-20 items if discussed)
- Extract treatment engagement and therapeutic progress
- Note leave status and conditions`,
    formattingAddendum: `
FORENSIC-SPECIFIC FORMATTING:
- Include legal status section with relevant orders
- Violence risk assessment (structured professional judgement)
- Substance use in context of offending
- Victim safety considerations
- Security and privilege level
- Treatment engagement and progress
- Leave and graduated return to community plan
- Conditions of order compliance`,
    additionalSections: ['LEGAL STATUS', 'FORENSIC HISTORY', 'VIOLENCE RISK', 'VICTIM SAFETY', 'LEAVE/PRIVILEGES'],
    keyTerms: ['forensic', 'index offence', 'NCR', 'not criminally responsible',
      'supervision order', 'HCR-20', 'SAPROF', 'PCL-R', 'STATIC-99',
      'violence risk', 'recidivism', 'privilege', 'leave', 'escorted',
      'unescorted', 'security', 'victim', 'corrections', 'parole'],
  },

  'perinatal': {
    name: 'Perinatal Mental Health',
    extractionAddendum: `
PERINATAL-SPECIFIC EXTRACTION:
- Extract pregnancy/postpartum stage (trimester, weeks postpartum)
- Note breastfeeding status — critical for medication decisions
- Extract bonding/attachment observations with infant
- Note Edinburgh Postnatal Depression Scale (EPDS) score if mentioned
- Extract birth trauma history
- Note infant welfare concerns
- Extract partner/family support status
- Note medication safety in pregnancy/breastfeeding discussion`,
    formattingAddendum: `
PERINATAL-SPECIFIC FORMATTING:
- Include perinatal stage prominently
- Breastfeeding status (essential for prescribing)
- Mother-infant attachment observations
- EPDS score and trend
- Medication safety in pregnancy/breastfeeding section
- Birth history (if postnatal)
- Support system and partner involvement
- Child protection screening
- Parenting capacity observations`,
    additionalSections: ['PERINATAL STATUS', 'BREASTFEEDING', 'MOTHER-INFANT ATTACHMENT', 'EPDS', 'SUPPORT SYSTEM'],
    keyTerms: ['perinatal', 'postnatal', 'postpartum', 'antenatal', 'prenatal',
      'breastfeeding', 'bonding', 'attachment', 'EPDS', 'Edinburgh',
      'birth trauma', 'tokophobia', 'infanticide', 'baby blues',
      'lactation', 'teratogenic', 'trimester'],
  },

  'addiction': {
    name: 'Addiction / AOD',
    extractionAddendum: `
ADDICTION-SPECIFIC EXTRACTION:
- Extract substance use history in detail (type, route, frequency, quantity, last use)
- Note withdrawal signs and symptoms, CIWA/COWS score if mentioned
- Extract treatment history (detox, rehab, OTP, naltrexone)
- Note motivational stage (pre-contemplation, contemplation, preparation, action, maintenance)
- Extract harm reduction strategies discussed
- Note SafeScript/prescription monitoring concerns
- Extract triggers and high-risk situations
- Note comorbid mental health conditions`,
    formattingAddendum: `
ADDICTION-SPECIFIC FORMATTING:
- Substance use assessment (current use table: substance, route, frequency, last use)
- Withdrawal assessment and scoring
- Treatment history (previous detox, rehab, pharmacotherapy)
- Motivational stage assessment
- Harm reduction plan
- Pharmacotherapy plan (OTP, naltrexone, acamprosate, etc.)
- Relapse prevention planning
- SafeScript compliance
- Comorbidity management`,
    additionalSections: ['SUBSTANCE USE ASSESSMENT', 'WITHDRAWAL', 'MOTIVATIONAL STAGE', 'HARM REDUCTION', 'PHARMACOTHERAPY'],
    keyTerms: ['AOD', 'alcohol', 'cannabis', 'methamphetamine', 'heroin', 'opioid',
      'buprenorphine', 'methadone', 'naltrexone', 'Suboxone', 'OTP',
      'CIWA', 'COWS', 'withdrawal', 'detox', 'rehab', 'SafeScript',
      'harm reduction', 'naloxone', 'needle exchange', 'relapse'],
  },
};

export function getSpecialtyConfig(specialty: string): SpecialtyConfig {
  return SPECIALTY_CONFIGS[specialty] ?? SPECIALTY_CONFIGS.psychiatry;
}

export function getSpecialtyExtractionPrompt(specialty: string): string {
  const config = getSpecialtyConfig(specialty);
  return config.extractionAddendum;
}

export function getSpecialtyFormattingPrompt(specialty: string): string {
  const config = getSpecialtyConfig(specialty);
  return config.formattingAddendum;
}

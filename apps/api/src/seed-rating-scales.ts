/**
 * Enterprise Rating Scale Seed
 *
 * Seeds 35 psychiatric rating scales into BOTH:
 * - templates (used by /api/v1/templates and Assessments tab)
 * - clinical_templates (used by staff-settings template surfaces)
 *
 * Each scale is tagged with:
 * - Type: Self-rated | Clinician-rated
 * - Age: target cohort
 * - Focus: diagnosis/domain intent
 *
 * Run:
 * npx ts-node -r dotenv/config -r tsconfig-paths/register --project tsconfig.node.json src/seed-rating-scales.ts
 */

import { randomUUID } from 'crypto';
import { dbAdmin as db, appPoolRaw, clearPoolMonitor } from './db/db';

type RespondentType = 'self' | 'clinician';

interface ScaleField {
  type: 'heading' | 'instruction' | 'text_block' | 'short_answer' | 'yes_no' | 'multiple_choice' | 'multi_select' | 'likert' | 'score';
  label?: string;
  text?: string;
  min?: number;
  max?: number;
  options?: string[];
  formula?: 'sum' | 'mean';
  itemIndexes?: number[];
  ranges?: Array<{ min: number; max: number; label: string }>;
}

interface SubscaleSpec {
  label: string;
  itemNumbers: number[]; // 1-based within scale question list
  formula?: 'sum' | 'mean';
  ranges?: Array<{ min: number; max: number; label: string }>;
}

interface LikertScaleSpec {
  name: string;
  respondentType: RespondentType;
  ageGroup: string;
  focus: string;
  instruction: string;
  items: string[];
  min: number;
  max: number;
  options: string[];
  subscales?: SubscaleSpec[];
  totalLabel?: string;
  totalRanges?: Array<{ min: number; max: number; label: string }>;
}

interface ScaleTemplate {
  name: string;
  type: 'assessment';
  category: 'Rating Scales';
  description: string;
  content: ScaleField[];
}

const FOUR_POINT_FREQ = ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)'];

const FIVE_POINT_DISTRESS = ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)'];

const FIVE_POINT_SEVERITY_0_4 = ['None (0)', 'Mild (1)', 'Moderate (2)', 'Marked (3)', 'Severe (4)'];

const FIVE_POINT_EXTENT = ['Not at all (0)', 'A little bit (1)', 'Moderately (2)', 'Quite a bit (3)', 'Extremely (4)'];

const SEVEN_POINT_CLINICAL = ['Absent (1)', 'Minimal (2)', 'Mild (3)', 'Moderate (4)', 'Moderately severe (5)', 'Severe (6)', 'Extremely severe (7)'];

const STALE_LEGACY_SCALE_NAMES = [
  'BPRS (Brief Psychiatric Rating Scale)',
  'CGI (Clinical Global Impression)',
  'GAD-7 (Generalised Anxiety Disorder)',
  'LSP-16 (Life Skills Profile)',
  'PHQ-9 (Patient Health Questionnaire)',
] as const;

function descriptor(respondentType: RespondentType, ageGroup: string, focus: string): string {
  const typeLabel = respondentType === 'self' ? 'Self-rated' : 'Clinician-rated';
  return `Type: ${typeLabel} | Age: ${ageGroup} | Focus: ${focus}`;
}

function buildLikertScale(spec: LikertScaleSpec): ScaleTemplate {
  const questionStartIndex = 2; // heading + instruction
  const content: ScaleField[] = [
    { type: 'heading', text: spec.name },
    { type: 'instruction', text: spec.instruction },
    ...spec.items.map((item) => ({
      type: 'likert' as const,
      label: item,
      min: spec.min,
      max: spec.max,
      options: spec.options,
    })),
  ];

  for (const subscale of spec.subscales ?? []) {
    content.push({
      type: 'score',
      label: subscale.label,
      formula: subscale.formula ?? 'sum',
      itemIndexes: subscale.itemNumbers.map((n) => questionStartIndex + n - 1),
      ranges: subscale.ranges,
    });
  }

  content.push({
    type: 'score',
    label: spec.totalLabel ?? 'Total Score',
    formula: 'sum',
    ranges: spec.totalRanges,
  });

  return {
    name: spec.name,
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor(spec.respondentType, spec.ageGroup, spec.focus),
    content,
  };
}

function buildYesNoScale(input: { name: string; respondentType: RespondentType; ageGroup: string; focus: string; instruction: string; items: string[]; totalLabel?: string; totalRanges?: Array<{ min: number; max: number; label: string }> }): ScaleTemplate {
  const content: ScaleField[] = [
    { type: 'heading', text: input.name },
    { type: 'instruction', text: input.instruction },
    ...input.items.map((item) => ({ type: 'yes_no' as const, label: item })),
    {
      type: 'score',
      label: input.totalLabel ?? 'Total Score',
      formula: 'sum',
      ranges: input.totalRanges,
    },
  ];
  return {
    name: input.name,
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor(input.respondentType, input.ageGroup, input.focus),
    content,
  };
}

const SCALE_CATALOG: ScaleTemplate[] = [
  buildLikertScale({
    name: 'PHQ-9 (Patient Health Questionnaire-9)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Depression',
    instruction: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
    items: ['Little interest or pleasure in doing things', 'Feeling down, depressed, or hopeless', 'Trouble falling or staying asleep, or sleeping too much', 'Feeling tired or having little energy', 'Poor appetite or overeating', 'Feeling bad about yourself — or that you are a failure or have let yourself or your family down', 'Trouble concentrating on things, such as reading or watching television', 'Moving or speaking so slowly that other people could have noticed; or being fidgety/restless', 'Thoughts that you would be better off dead, or thoughts of hurting yourself'],
    min: 0,
    max: 3,
    options: FOUR_POINT_FREQ,
    totalLabel: 'Total Score (0-27)',
    totalRanges: [
      { min: 0, max: 4, label: 'Minimal depression' },
      { min: 5, max: 9, label: 'Mild depression' },
      { min: 10, max: 14, label: 'Moderate depression' },
      { min: 15, max: 19, label: 'Moderately severe depression' },
      { min: 20, max: 27, label: 'Severe depression' },
    ],
  }),
  buildLikertScale({
    name: 'GAD-7 (Generalized Anxiety Disorder-7)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Generalized anxiety',
    instruction: 'Over the last 2 weeks, how often have you been bothered by the following problems?',
    items: ['Feeling nervous, anxious, or on edge', 'Not being able to stop or control worrying', 'Worrying too much about different things', 'Trouble relaxing', 'Being so restless that it is hard to sit still', 'Becoming easily annoyed or irritable', 'Feeling afraid as if something awful might happen'],
    min: 0,
    max: 3,
    options: FOUR_POINT_FREQ,
    totalLabel: 'Total Score (0-21)',
    totalRanges: [
      { min: 0, max: 4, label: 'Minimal anxiety' },
      { min: 5, max: 9, label: 'Mild anxiety' },
      { min: 10, max: 14, label: 'Moderate anxiety' },
      { min: 15, max: 21, label: 'Severe anxiety' },
    ],
  }),
  buildLikertScale({
    name: 'K10 (Kessler Psychological Distress Scale)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Psychological distress',
    instruction: 'In the last 4 weeks, how often did you feel the following?',
    items: ['Tired out for no good reason', 'Nervous', 'So nervous that nothing could calm you down', 'Hopeless', 'Restless or fidgety', 'So restless that you could not sit still', 'Depressed', 'That everything was an effort', 'So sad that nothing could cheer you up', 'Worthless'],
    min: 1,
    max: 5,
    options: FIVE_POINT_DISTRESS,
    totalLabel: 'Total Score (10-50)',
    totalRanges: [
      { min: 10, max: 19, label: 'Likely to be well' },
      { min: 20, max: 24, label: 'Mild distress' },
      { min: 25, max: 29, label: 'Moderate distress' },
      { min: 30, max: 50, label: 'Severe distress' },
    ],
  }),
  buildLikertScale({
    name: 'DASS-21 (Depression Anxiety Stress Scales)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Depression, anxiety, stress',
    instruction: 'Please read each statement and rate how much it applied to you over the past week.',
    items: ['I found it hard to wind down', 'I was aware of dryness of my mouth', 'I could not seem to experience any positive feeling at all', 'I experienced breathing difficulty', 'I found it difficult to work up the initiative to do things', 'I tended to over-react to situations', 'I experienced trembling', 'I felt that I was using a lot of nervous energy', 'I was worried about situations in which I might panic', 'I felt that I had nothing to look forward to', 'I found myself getting agitated', 'I found it difficult to relax', 'I felt down-hearted and blue', 'I was intolerant of anything that kept me from getting on', 'I felt I was close to panic', 'I was unable to become enthusiastic about anything', 'I felt I was not worth much as a person', 'I felt that I was rather touchy', 'I was aware of the action of my heart in absence of physical exertion', 'I felt scared without good reason', 'I felt that life was meaningless'],
    min: 0,
    max: 3,
    options: ['Did not apply to me at all (0)', 'Applied to me to some degree (1)', 'Applied to me a considerable degree (2)', 'Applied to me very much (3)'],
    subscales: [
      { label: 'Depression Subscale (x2 equivalent)', itemNumbers: [3, 5, 10, 13, 16, 17, 21] },
      { label: 'Anxiety Subscale (x2 equivalent)', itemNumbers: [2, 4, 7, 9, 15, 19, 20] },
      { label: 'Stress Subscale (x2 equivalent)', itemNumbers: [1, 6, 8, 11, 12, 14, 18] },
    ],
    totalLabel: 'Total Score',
  }),
  buildLikertScale({
    name: 'PCL-5 (PTSD Checklist DSM-5)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Post-traumatic stress',
    instruction: 'In the past month, how much were you bothered by the following problems?',
    items: [
      'Repeated, disturbing, and unwanted memories of the stressful experience',
      'Repeated, disturbing dreams of the stressful experience',
      'Suddenly feeling or acting as if the stressful experience were actually happening again',
      'Feeling very upset when something reminded you of the stressful experience',
      'Having strong physical reactions when something reminded you of the stressful experience',
      'Avoiding memories, thoughts, or feelings related to the stressful experience',
      'Avoiding external reminders of the stressful experience',
      'Trouble remembering important parts of the stressful experience',
      'Having strong negative beliefs about yourself, others, or the world',
      'Blaming yourself or someone else for the stressful experience',
      'Having strong negative feelings such as fear, anger, guilt, or shame',
      'Loss of interest in activities you used to enjoy',
      'Feeling distant or cut off from other people',
      'Trouble experiencing positive feelings',
      'Irritable behavior, angry outbursts, or acting aggressively',
      'Taking too many risks or doing things that could cause harm',
      'Being super-alert or watchful/on guard',
      'Feeling jumpy or easily startled',
      'Having difficulty concentrating',
      'Trouble falling or staying asleep',
    ],
    min: 0,
    max: 4,
    options: FIVE_POINT_EXTENT,
    totalLabel: 'Total Score (0-80)',
    totalRanges: [
      { min: 0, max: 30, label: 'Below screening threshold' },
      { min: 31, max: 80, label: 'Probable PTSD' },
    ],
  }),
  buildLikertScale({
    name: 'AUDIT (Alcohol Use Disorders Identification Test)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Alcohol use',
    instruction: 'Please answer each question for the last 12 months.',
    items: ['How often do you have a drink containing alcohol?', 'How many standard drinks do you have on a typical day when drinking?', 'How often do you have six or more drinks on one occasion?', 'How often have you found that you could not stop drinking once you started?', 'How often have you failed to do what was expected because of drinking?', 'How often have you needed a drink in the morning to get going after heavy drinking?', 'How often have you had guilt or remorse after drinking?', 'How often have you been unable to remember what happened after drinking?', 'Have you or someone else been injured because of your drinking?', 'Has anyone been concerned about your drinking or suggested you cut down?'],
    min: 0,
    max: 4,
    options: ['Never (0)', 'Less than monthly (1)', 'Monthly (2)', 'Weekly (3)', 'Daily/almost daily (4)'],
    totalLabel: 'Total Score (0-40)',
    totalRanges: [
      { min: 0, max: 7, label: 'Low risk' },
      { min: 8, max: 15, label: 'Hazardous use' },
      { min: 16, max: 19, label: 'Harmful use' },
      { min: 20, max: 40, label: 'Possible dependence' },
    ],
  }),
  buildYesNoScale({
    name: 'DAST-10 (Drug Abuse Screening Test)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Drug use',
    instruction: 'These questions refer to drug use in the past 12 months.',
    items: ['Used drugs other than those required for medical reasons', 'Abuse more than one drug at a time', 'Unable to stop using drugs when you want to', 'Experienced blackouts/flashbacks due to drug use', 'Felt bad or guilty about drug use', 'Family complained about your involvement with drugs', 'Neglected your family because of drug use', 'Engaged in illegal activities to obtain drugs', 'Experienced withdrawal symptoms when stopping drugs', 'Had medical problems as a result of drug use'],
    totalLabel: 'Total Score (0-10)',
    totalRanges: [
      { min: 0, max: 0, label: 'No problems reported' },
      { min: 1, max: 2, label: 'Low level concern' },
      { min: 3, max: 5, label: 'Moderate level concern' },
      { min: 6, max: 8, label: 'Substantial level concern' },
      { min: 9, max: 10, label: 'Severe level concern' },
    ],
  }),
  buildLikertScale({
    name: 'BDI-II (Beck Depression Inventory-II)',
    respondentType: 'self',
    ageGroup: 'Adolescent/Adult',
    focus: 'Depression',
    instruction: 'Rate each item for how you have been feeling over the past 2 weeks.',
    items: ['Sadness', 'Pessimism', 'Past failure', 'Loss of pleasure', 'Guilty feelings', 'Punishment feelings', 'Self-dislike', 'Self-criticalness', 'Suicidal thoughts or wishes', 'Crying', 'Agitation', 'Loss of interest', 'Indecisiveness', 'Worthlessness', 'Loss of energy', 'Changes in sleep pattern', 'Irritability', 'Changes in appetite', 'Concentration difficulty', 'Tiredness or fatigue', 'Loss of interest in sex'],
    min: 0,
    max: 3,
    options: ['0', '1', '2', '3'],
    totalLabel: 'Total Score (0-63)',
    totalRanges: [
      { min: 0, max: 13, label: 'Minimal depression' },
      { min: 14, max: 19, label: 'Mild depression' },
      { min: 20, max: 28, label: 'Moderate depression' },
      { min: 29, max: 63, label: 'Severe depression' },
    ],
  }),
  buildLikertScale({
    name: 'BAI (Beck Anxiety Inventory)',
    respondentType: 'self',
    ageGroup: 'Adolescent/Adult',
    focus: 'Anxiety',
    instruction: 'Rate each symptom for how much it bothered you in the past week.',
    items: ['Numbness or tingling', 'Feeling hot', 'Wobbliness in legs', 'Unable to relax', 'Fear of worst happening', 'Dizzy or lightheaded', 'Heart pounding/racing', 'Unsteady', 'Terrified or afraid', 'Nervous', 'Feeling of choking', 'Hands trembling', 'Shaky/unsteady', 'Fear of losing control', 'Difficulty breathing', 'Fear of dying', 'Scared', 'Indigestion', 'Faint/lightheaded', 'Face flushed', 'Hot/cold sweats'],
    min: 0,
    max: 3,
    options: ['Not at all (0)', 'Mildly (1)', 'Moderately (2)', 'Severely (3)'],
    totalLabel: 'Total Score (0-63)',
    totalRanges: [
      { min: 0, max: 7, label: 'Minimal anxiety' },
      { min: 8, max: 15, label: 'Mild anxiety' },
      { min: 16, max: 25, label: 'Moderate anxiety' },
      { min: 26, max: 63, label: 'Severe anxiety' },
    ],
  }),
  buildLikertScale({
    name: 'EPDS (Edinburgh Postnatal Depression Scale)',
    respondentType: 'self',
    ageGroup: 'Perinatal',
    focus: 'Perinatal depression',
    instruction: 'Please select the response that best describes how you have felt in the past 7 days.',
    items: ['I have been able to laugh and see the funny side of things', 'I have looked forward with enjoyment to things', 'I have blamed myself unnecessarily when things went wrong', 'I have been anxious or worried for no good reason', 'I have felt scared or panicky for no very good reason', 'Things have been getting on top of me', 'I have been so unhappy that I have had difficulty sleeping', 'I have felt sad or miserable', 'I have been so unhappy that I have been crying', 'The thought of harming myself has occurred to me'],
    min: 0,
    max: 3,
    options: ['0', '1', '2', '3'],
    totalLabel: 'Total Score (0-30)',
    totalRanges: [
      { min: 0, max: 8, label: 'Depression not likely' },
      { min: 9, max: 11, label: 'Possible depression' },
      { min: 12, max: 30, label: 'High likelihood of depression' },
    ],
  }),
  buildLikertScale({
    name: 'PSS-10 (Perceived Stress Scale)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Perceived stress',
    instruction: 'In the last month, how often have you felt the following?',
    items: ['Upset because of something that happened unexpectedly', 'Unable to control important things in your life', 'Nervous and stressed', 'Confident about your ability to handle personal problems', 'Things were going your way', 'Could not cope with all the things you had to do', 'Able to control irritations in your life', 'Felt you were on top of things', 'Angered because of things outside your control', 'Felt difficulties were piling up too high to overcome'],
    min: 0,
    max: 4,
    options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)'],
    totalLabel: 'Total Score (0-40)',
  }),
  buildLikertScale({
    name: 'ISI (Insomnia Severity Index)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Insomnia',
    instruction: 'Rate your current insomnia problem over the last 2 weeks.',
    items: ['Difficulty falling asleep', 'Difficulty staying asleep', 'Problem waking up too early', 'How satisfied/dissatisfied are you with your current sleep pattern', 'How noticeable to others do you think your sleep problem is', 'How worried/distressed are you about your current sleep problem', 'To what extent do you consider your sleep problem to interfere with daily functioning'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Total Score (0-28)',
    totalRanges: [
      { min: 0, max: 7, label: 'No clinically significant insomnia' },
      { min: 8, max: 14, label: 'Subthreshold insomnia' },
      { min: 15, max: 21, label: 'Moderate insomnia' },
      { min: 22, max: 28, label: 'Severe insomnia' },
    ],
  }),
  buildLikertScale({
    name: 'PSQI (Pittsburgh Sleep Quality Index - Component Ratings)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Sleep quality',
    instruction: 'Rate each PSQI component (0 to 3) for the previous month.',
    items: ['Subjective sleep quality', 'Sleep latency', 'Sleep duration', 'Habitual sleep efficiency', 'Sleep disturbances', 'Use of sleep medication', 'Daytime dysfunction'],
    min: 0,
    max: 3,
    options: ['0', '1', '2', '3'],
    totalLabel: 'Global Score (0-21)',
    totalRanges: [
      { min: 0, max: 5, label: 'Good sleep quality' },
      { min: 6, max: 21, label: 'Poor sleep quality' },
    ],
  }),
  buildLikertScale({
    name: 'WHO-5 (World Health Organization Well-Being Index)',
    respondentType: 'self',
    ageGroup: 'Adolescent/Adult',
    focus: 'Well-being',
    instruction: 'Over the last 2 weeks, how often have you felt the following?',
    items: ['I have felt cheerful and in good spirits', 'I have felt calm and relaxed', 'I have felt active and vigorous', 'I woke up feeling fresh and rested', 'My daily life has been filled with things that interest me'],
    min: 0,
    max: 5,
    options: ['At no time (0)', 'Some of the time (1)', 'Less than half the time (2)', 'More than half the time (3)', 'Most of the time (4)', 'All of the time (5)'],
    totalLabel: 'Raw Score (0-25)',
    totalRanges: [
      { min: 0, max: 12, label: 'Poor well-being (screen positive)' },
      { min: 13, max: 25, label: 'Adequate well-being' },
    ],
  }),
  buildLikertScale({
    name: 'SDS (Sheehan Disability Scale)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Functional impairment',
    instruction: 'On a scale from 0 to 10, rate how symptoms disrupted these areas in the past week.',
    items: ['Work/School impairment', 'Social life impairment', 'Family/home responsibilities impairment'],
    min: 0,
    max: 10,
    options: [],
    totalLabel: 'Total Functional Impairment (0-30)',
  }),
  buildYesNoScale({
    name: 'MDQ (Mood Disorder Questionnaire)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Bipolar spectrum screening',
    instruction: 'Indicate whether you have ever experienced each symptom.',
    items: ['Felt so good or hyper that other people thought you were not your normal self', 'So irritable that you shouted at people or started fights', 'Felt much more self-confident than usual', 'Got much less sleep than usual and did not miss it', 'More talkative or spoke much faster than usual', 'Thoughts raced through your head', 'Easily distracted by things around you', 'Had much more energy than usual', 'Were much more active or did many more things than usual', 'Were much more social or outgoing than usual', 'Were much more interested in sex than usual', 'Did things unusual for you or that others thought excessive/foolish/risky', 'Spent money that got you or your family into trouble'],
    totalLabel: 'Symptom Count',
  }),
  buildLikertScale({
    name: 'ASRS v1.1 (Adult ADHD Self-Report Scale)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'ADHD symptoms',
    instruction: 'How often have each of the following occurred over the past 6 months?',
    items: [
      'Trouble wrapping up final details of a project once challenging parts are done',
      'Difficulty getting things in order for a task that requires organization',
      'Problems remembering appointments or obligations',
      'Avoid or delay tasks requiring a lot of thought',
      'Fidget or squirm when having to sit for long periods',
      'Feel overly active and compelled to do things as if driven by a motor',
      'Make careless mistakes on boring or difficult projects',
      'Difficulty keeping attention on repetitive work',
      'Difficulty concentrating on what people say even when addressed directly',
      'Misplace or have difficulty finding things at home or work',
      'Distracted by activity or noise around you',
      'Leave your seat in meetings or situations where staying seated is expected',
      'Feel restless or fidgety',
      'Difficulty unwinding and relaxing when you have time to yourself',
      'Talk too much in social situations',
      'Finish people’s sentences before they can do it themselves',
      'Difficulty waiting your turn in situations requiring turn-taking',
      'Interrupt others when they are busy',
    ],
    min: 0,
    max: 4,
    options: ['Never (0)', 'Rarely (1)', 'Sometimes (2)', 'Often (3)', 'Very often (4)'],
    totalLabel: 'Total Score (0-72)',
  }),
  buildLikertScale({
    name: 'OCI-R (Obsessive-Compulsive Inventory - Revised)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Obsessive-compulsive symptoms',
    instruction: 'Rate distress caused by each symptom during the past month.',
    items: [
      'I have saved up so many things that they get in the way',
      'I check things more often than necessary',
      'I get upset if objects are not arranged properly',
      'I feel compelled to count while I am doing things',
      'I find it difficult to touch objects when I know they have been touched by strangers',
      'I find it difficult to control my own thoughts',
      'I collect things I do not need',
      'I repeatedly check doors, windows, drawers, etc.',
      'I get upset if others change the way I arranged things',
      'I feel I have to repeat certain numbers',
      'I sometimes have to wash or clean myself simply because I feel contaminated',
      'I am upset by unpleasant thoughts that come into my mind against my will',
      'I avoid throwing things away because I am afraid I might need them later',
      'I repeatedly check gas and water taps and light switches',
      'I need things to be arranged in a particular order',
      'I feel that there are good and bad numbers',
      'I wash my hands more often and longer than necessary',
      'I frequently get nasty thoughts and have difficulty getting rid of them',
    ],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    subscales: [
      { label: 'Washing Subscale', itemNumbers: [5, 11, 17] },
      { label: 'Checking Subscale', itemNumbers: [2, 8, 14] },
      { label: 'Ordering Subscale', itemNumbers: [3, 9, 15] },
      { label: 'Obsessing Subscale', itemNumbers: [6, 12, 18] },
      { label: 'Hoarding Subscale', itemNumbers: [1, 7, 13] },
      { label: 'Neutralizing Subscale', itemNumbers: [4, 10, 16] },
    ],
    totalLabel: 'Total Score (0-72)',
  }),
  buildLikertScale({
    name: 'Y-BOCS-SR (Yale-Brown Obsessive Compulsive Scale - Self Report)',
    respondentType: 'self',
    ageGroup: 'Adult',
    focus: 'Obsessive-compulsive severity',
    instruction: 'Rate severity for obsessions and compulsions during the past week.',
    items: ['Time occupied by obsessive thoughts', 'Interference due to obsessive thoughts', 'Distress associated with obsessive thoughts', 'Resistance against obsessions', 'Degree of control over obsessive thoughts', 'Time spent performing compulsive behaviors', 'Interference due to compulsive behaviors', 'Distress if compulsions prevented', 'Resistance against compulsions', 'Degree of control over compulsive behavior'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    subscales: [
      { label: 'Obsession Subscale (0-20)', itemNumbers: [1, 2, 3, 4, 5] },
      { label: 'Compulsion Subscale (0-20)', itemNumbers: [6, 7, 8, 9, 10] },
    ],
    totalLabel: 'Total Score (0-40)',
    totalRanges: [
      { min: 0, max: 7, label: 'Subclinical' },
      { min: 8, max: 15, label: 'Mild' },
      { min: 16, max: 23, label: 'Moderate' },
      { min: 24, max: 31, label: 'Severe' },
      { min: 32, max: 40, label: 'Extreme' },
    ],
  }),
  buildLikertScale({
    name: 'RCADS-25 (Revised Child Anxiety and Depression Scale)',
    respondentType: 'self',
    ageGroup: 'Child/Adolescent',
    focus: 'Youth anxiety and depression',
    instruction: 'Please circle how often each thing happens to you.',
    items: ['I worry about things', 'I feel sad or empty', 'I get scared if I have to sleep on my own', 'I have trouble sleeping because of worries', 'I feel scared when I have to take a test', 'I feel tired a lot', 'I worry that something bad will happen to me', 'I feel worthless', 'I am afraid of being in crowded places', 'I feel like nothing is fun anymore', 'I worry that I will do badly at school', 'I feel shaky', 'I avoid things because I am scared', 'I feel down', 'I have thoughts that make me feel upset', 'I get scared when I am away from my parents/carers', 'I feel lonely', 'My heart suddenly beats too quickly for no reason', 'I worry that I might look silly', 'I have little appetite', 'I feel frightened suddenly for no reason', 'I cannot stop worrying', 'I cry easily', 'I avoid school or activities because of fear', 'I feel hopeless about the future'],
    min: 0,
    max: 3,
    options: ['Never (0)', 'Sometimes (1)', 'Often (2)', 'Always (3)'],
    totalLabel: 'Total Score (0-75)',
  }),
  buildLikertScale({
    name: 'HAM-D 17 (Hamilton Depression Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Clinician-rated depression severity',
    instruction: 'Clinician-rated depression interview over the past week.',
    items: ['Depressed mood', 'Feelings of guilt', 'Suicide', 'Insomnia early', 'Insomnia middle', 'Insomnia late', 'Work and activities', 'Retardation', 'Agitation', 'Anxiety psychic', 'Anxiety somatic', 'Somatic symptoms gastrointestinal', 'Somatic symptoms general', 'Genital symptoms', 'Hypochondriasis', 'Loss of weight', 'Insight'],
    min: 0,
    max: 4,
    options: ['0', '1', '2', '3', '4'],
    totalLabel: 'Total Score (0-52)',
    totalRanges: [
      { min: 0, max: 7, label: 'Normal' },
      { min: 8, max: 13, label: 'Mild depression' },
      { min: 14, max: 18, label: 'Moderate depression' },
      { min: 19, max: 22, label: 'Severe depression' },
      { min: 23, max: 52, label: 'Very severe depression' },
    ],
  }),
  buildLikertScale({
    name: 'HAM-A (Hamilton Anxiety Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Clinician-rated anxiety severity',
    instruction: 'Rate severity of each anxiety symptom cluster over the past week.',
    items: ['Anxious mood', 'Tension', 'Fears', 'Insomnia', 'Intellectual (cognitive)', 'Depressed mood', 'Somatic muscular', 'Somatic sensory', 'Cardiovascular symptoms', 'Respiratory symptoms', 'Gastrointestinal symptoms', 'Genitourinary symptoms', 'Autonomic symptoms', 'Behavior at interview'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Total Score (0-56)',
    totalRanges: [
      { min: 0, max: 17, label: 'Mild severity' },
      { min: 18, max: 24, label: 'Mild to moderate severity' },
      { min: 25, max: 30, label: 'Moderate to severe' },
      { min: 31, max: 56, label: 'Severe anxiety' },
    ],
  }),
  buildLikertScale({
    name: 'MADRS (Montgomery-Åsberg Depression Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Depression severity',
    instruction: 'Clinician-rated depression severity (0 to 6 each item).',
    items: ['Apparent sadness', 'Reported sadness', 'Inner tension', 'Reduced sleep', 'Reduced appetite', 'Concentration difficulties', 'Lassitude', 'Inability to feel', 'Pessimistic thoughts', 'Suicidal thoughts'],
    min: 0,
    max: 6,
    options: ['0', '1', '2', '3', '4', '5', '6'],
    totalLabel: 'Total Score (0-60)',
    totalRanges: [
      { min: 0, max: 6, label: 'Normal/symptom absent' },
      { min: 7, max: 19, label: 'Mild depression' },
      { min: 20, max: 34, label: 'Moderate depression' },
      { min: 35, max: 60, label: 'Severe depression' },
    ],
  }),
  buildLikertScale({
    name: 'YMRS (Young Mania Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Mania severity',
    instruction: 'Clinician-rated mania severity over the last 48 hours.',
    items: ['Elevated mood', 'Increased motor activity/energy', 'Sexual interest', 'Sleep', 'Irritability', 'Speech (rate and amount)', 'Language-thought disorder', 'Content', 'Disruptive-aggressive behavior', 'Appearance', 'Insight'],
    min: 0,
    max: 8,
    options: ['0', '1', '2', '3', '4', '5', '6', '7', '8'],
    totalLabel: 'Total Score (0-60)',
    totalRanges: [
      { min: 0, max: 12, label: 'Remission/minimal symptoms' },
      { min: 13, max: 19, label: 'Subthreshold mania' },
      { min: 20, max: 25, label: 'Mild mania' },
      { min: 26, max: 37, label: 'Moderate mania' },
      { min: 38, max: 60, label: 'Severe mania' },
    ],
  }),
  buildLikertScale({
    name: 'BPRS-24 (Brief Psychiatric Rating Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Psychosis and global symptom burden',
    instruction: 'Rate each symptom severity from 1 to 7 using interview and observation.',
    items: ['Somatic concern', 'Anxiety', 'Depression', 'Suicidality', 'Guilt', 'Hostility', 'Elevated mood', 'Grandiosity', 'Suspiciousness', 'Hallucinations', 'Unusual thought content', 'Bizarre behavior', 'Self-neglect', 'Disorientation', 'Conceptual disorganization', 'Blunted affect', 'Emotional withdrawal', 'Motor retardation', 'Tension', 'Uncooperativeness', 'Excitement', 'Distractibility', 'Motor hyperactivity', 'Mannerisms/posturing'],
    min: 1,
    max: 7,
    options: SEVEN_POINT_CLINICAL,
    totalLabel: 'Total Score (24-168)',
  }),
  buildLikertScale({
    name: 'PANSS (Positive and Negative Syndrome Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Schizophrenia spectrum severity',
    instruction: 'Rate each PANSS item from 1 to 7.',
    items: ['P1 Delusions', 'P2 Conceptual disorganization', 'P3 Hallucinatory behavior', 'P4 Excitement', 'P5 Grandiosity', 'P6 Suspiciousness/persecution', 'P7 Hostility', 'N1 Blunted affect', 'N2 Emotional withdrawal', 'N3 Poor rapport', 'N4 Passive/apathetic social withdrawal', 'N5 Difficulty in abstract thinking', 'N6 Lack of spontaneity', 'N7 Stereotyped thinking', 'G1 Somatic concern', 'G2 Anxiety', 'G3 Guilt feelings', 'G4 Tension', 'G5 Mannerisms and posturing', 'G6 Depression', 'G7 Motor retardation', 'G8 Uncooperativeness', 'G9 Unusual thought content', 'G10 Disorientation', 'G11 Poor attention', 'G12 Lack of judgment and insight', 'G13 Disturbance of volition', 'G14 Poor impulse control', 'G15 Preoccupation', 'G16 Active social avoidance'],
    min: 1,
    max: 7,
    options: SEVEN_POINT_CLINICAL,
    subscales: [
      { label: 'Positive Subscale (P1-P7)', itemNumbers: [1, 2, 3, 4, 5, 6, 7] },
      { label: 'Negative Subscale (N1-N7)', itemNumbers: [8, 9, 10, 11, 12, 13, 14] },
      { label: 'General Psychopathology Subscale (G1-G16)', itemNumbers: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] },
    ],
    totalLabel: 'Total Score (30-210)',
  }),
  buildLikertScale({
    name: 'AIMS (Abnormal Involuntary Movement Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Tardive dyskinesia / movement disorder monitoring',
    instruction: 'Rate each observed involuntary movement item from 0 to 4.',
    items: ['Facial and oral movements: muscles of facial expression', 'Facial and oral movements: lips/perioral area', 'Facial and oral movements: jaw', 'Facial and oral movements: tongue', 'Extremity movements: upper', 'Extremity movements: lower', 'Trunk movements', 'Global severity of abnormal movements', 'Incapacitation due to abnormal movements', 'Patient awareness/distress of abnormal movements'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Total Score',
  }),
  buildLikertScale({
    name: 'SAS (Simpson-Angus Scale)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Extrapyramidal side effects',
    instruction: 'Rate each EPS sign from 0 (normal) to 4 (extreme).',
    items: ['Gait', 'Arm dropping', 'Shoulder shaking', 'Elbow rigidity', 'Wrist rigidity', 'Leg pendulousness', 'Head dropping', 'Glabellar tap', 'Tremor', 'Salivation'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Mean Score (sum/10)',
    subscales: [
      {
        label: 'Mean EPS Score',
        itemNumbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        formula: 'mean',
        ranges: [
          { min: 0, max: 0.3, label: 'Normal range' },
          { min: 0.31, max: 4, label: 'Clinically significant EPS' },
        ],
      },
    ],
  }),
  buildLikertScale({
    name: 'CGI (Clinical Global Impression - Severity/Improvement)',
    respondentType: 'clinician',
    ageGroup: 'General',
    focus: 'Global clinical status',
    instruction: 'Rate severity and improvement from 1 to 7.',
    items: ['CGI-Severity (1=Normal, 7=Among the most extremely ill)', 'CGI-Improvement (1=Very much improved, 7=Very much worse)'],
    min: 1,
    max: 7,
    options: ['1', '2', '3', '4', '5', '6', '7'],
    totalLabel: 'Combined CGI Score',
  }),
  buildLikertScale({
    name: 'HoNOS (Health of the Nation Outcome Scales)',
    respondentType: 'clinician',
    ageGroup: 'Adult',
    focus: 'Adult outcome domains',
    instruction: 'Rate most severe problem over period, 0 (none) to 4 (severe).',
    items: ['Overactive/aggressive/disruptive behavior', 'Non-accidental self-injury', 'Problem drinking/drug-taking', 'Cognitive problems', 'Physical illness/disability problems', 'Hallucinations/delusions', 'Depressed mood', 'Other mental and behavioral problems', 'Problems with relationships', 'Problems with activities of daily living', 'Problems with living conditions', 'Problems with occupation/activities'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    subscales: [
      { label: 'Behavior Subscale', itemNumbers: [1, 2, 3] },
      { label: 'Impairment Subscale', itemNumbers: [4, 5] },
      { label: 'Symptoms Subscale', itemNumbers: [6, 7, 8] },
      { label: 'Social Subscale', itemNumbers: [9, 10, 11, 12] },
    ],
    totalLabel: 'Total Score (0-48)',
  }),
  buildLikertScale({
    name: 'HoNOS 65+ (Older Persons)',
    respondentType: 'clinician',
    ageGroup: 'Older adult',
    focus: 'Older persons mental health outcomes',
    instruction: 'Rate each domain from 0 (none) to 4 (severe).',
    items: ['Behavioral disturbance', 'Non-accidental self-injury', 'Problem drinking/drug-taking', 'Cognitive problems', 'Physical illness/disability problems', 'Psychotic symptoms', 'Depressed mood', 'Other mental and behavioral problems', 'Social/relationship problems', 'ADL problems', 'Living condition problems', 'Occupation/activities problems'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Total Score (0-48)',
  }),
  buildLikertScale({
    name: 'HoNOSCA (Child and Adolescent)',
    respondentType: 'clinician',
    ageGroup: 'Child/Adolescent',
    focus: 'Youth mental health outcomes',
    instruction: 'Rate each domain from 0 (none) to 4 (severe).',
    items: ['Disruptive, antisocial, or aggressive behavior', 'Overactivity, attention, and concentration', 'Non-accidental self-injury', 'Problem drinking/drug-taking', 'Scholastic/language difficulties', 'Physical illness/disability', 'Hallucinations and delusions', 'Non-organic somatic symptoms', 'Emotional and related symptoms', 'Peer relationship problems', 'Self-care and independence', 'Family life and relationships', 'Poor school attendance'],
    min: 0,
    max: 4,
    options: FIVE_POINT_SEVERITY_0_4,
    totalLabel: 'Total Score (0-52)',
  }),
  buildLikertScale({
    name: 'GAF (Global Assessment of Functioning)',
    respondentType: 'clinician',
    ageGroup: 'General',
    focus: 'Global functioning',
    instruction: 'Rate current functioning on a continuum from 1 to 100.',
    items: ['Current GAF score'],
    min: 1,
    max: 100,
    options: [],
    totalLabel: 'GAF Score (1-100)',
    totalRanges: [
      { min: 1, max: 20, label: 'Severe dysfunction / danger range' },
      { min: 21, max: 40, label: 'Major impairment' },
      { min: 41, max: 60, label: 'Moderate symptoms/impairment' },
      { min: 61, max: 80, label: 'Mild/transient symptoms' },
      { min: 81, max: 100, label: 'Minimal symptoms / superior functioning' },
    ],
  }),
  {
    name: 'MMSE (Mini-Mental State Examination)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Older adult/General', 'Cognitive screening'),
    content: [
      { type: 'heading', text: 'MMSE (Mini-Mental State Examination)' },
      { type: 'instruction', text: 'Score each domain according to standard MMSE administration.' },
      { type: 'likert', label: 'Orientation to time (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Orientation to place (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Registration (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Attention/calculation (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Recall (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Language naming (0-2)', min: 0, max: 2, options: [] },
      { type: 'likert', label: 'Repetition (0-1)', min: 0, max: 1, options: [] },
      { type: 'likert', label: '3-stage command (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Read and obey (0-1)', min: 0, max: 1, options: [] },
      { type: 'likert', label: 'Write a sentence (0-1)', min: 0, max: 1, options: [] },
      { type: 'likert', label: 'Copy intersecting pentagons (0-1)', min: 0, max: 1, options: [] },
      {
        type: 'score',
        label: 'Total MMSE Score (0-30)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 17, label: 'Severe cognitive impairment' },
          { min: 18, max: 23, label: 'Mild cognitive impairment range' },
          { min: 24, max: 30, label: 'Cognition broadly intact' },
        ],
      },
    ],
  },
  {
    name: 'MoCA (Montreal Cognitive Assessment)',
    type: 'assessment',
    category: 'Rating Scales',
    description: descriptor('clinician', 'Older adult/General', 'Mild cognitive impairment screening'),
    content: [
      { type: 'heading', text: 'MoCA (Montreal Cognitive Assessment)' },
      { type: 'instruction', text: 'Score each domain according to standard MoCA administration.' },
      { type: 'likert', label: 'Visuospatial/executive (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Naming (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Attention (0-6)', min: 0, max: 6, options: [] },
      { type: 'likert', label: 'Language (0-3)', min: 0, max: 3, options: [] },
      { type: 'likert', label: 'Abstraction (0-2)', min: 0, max: 2, options: [] },
      { type: 'likert', label: 'Delayed recall (0-5)', min: 0, max: 5, options: [] },
      { type: 'likert', label: 'Orientation (0-6)', min: 0, max: 6, options: [] },
      { type: 'likert', label: 'Education correction (+1 if <=12 years education)', min: 0, max: 1, options: [] },
      {
        type: 'score',
        label: 'Total MoCA Score (0-30)',
        formula: 'sum',
        ranges: [
          { min: 0, max: 17, label: 'Moderate/severe impairment range' },
          { min: 18, max: 25, label: 'Mild impairment range' },
          { min: 26, max: 30, label: 'Normal range' },
        ],
      },
    ],
  },
];

async function ensureRatingScaleCategory(clinicId: string): Promise<string> {
  const existing = await db('template_categories').where({ clinic_id: clinicId, name: 'Rating Scales' }).first('id');
  if (existing?.id) return String(existing.id);

  const id = randomUUID();
  await db('template_categories').insert({
    id,
    clinic_id: clinicId,
    name: 'Rating Scales',
    is_active: true,
    sort_order: 1,
    created_at: new Date(),
  });
  return id;
}

async function upsertTemplatesForClinic(clinicId: string, ratingCategoryId: string): Promise<void> {
  for (let index = 0; index < SCALE_CATALOG.length; index += 1) {
    const scale = SCALE_CATALOG[index]!;
    const now = new Date();
    const contentJson = JSON.stringify(scale.content);

    const existingTemplate = await db('templates').where({ clinic_id: clinicId, name: scale.name }).first('id');

    if (existingTemplate?.id) {
      await db('templates').where({ id: existingTemplate.id }).update({
        type: scale.type,
        category: scale.category,
        description: scale.description,
        content: contentJson,
        is_active: true,
        status: 'published',
        sort_order: index,
        deleted_at: null,
        retired_at: null,
        published_at: now,
        updated_at: now,
      });
    } else {
      await db('templates').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        name: scale.name,
        type: scale.type,
        category: scale.category,
        description: scale.description,
        content: contentJson,
        is_active: true,
        status: 'published',
        sort_order: index,
        created_by_id: null,
        published_at: now,
        created_at: now,
        updated_at: now,
      });
    }

    const existingClinicalTemplate = await db('clinical_templates').where({ clinic_id: clinicId, name: scale.name }).first('id');

    if (existingClinicalTemplate?.id) {
      await db('clinical_templates').where({ id: existingClinicalTemplate.id }).update({
        category_id: ratingCategoryId,
        type: scale.type,
        description: scale.description,
        content: contentJson,
        is_active: true,
        is_system: true,
        sort_order: index,
        updated_at: now,
      });
    } else {
      await db('clinical_templates').insert({
        id: randomUUID(),
        clinic_id: clinicId,
        category_id: ratingCategoryId,
        name: scale.name,
        type: scale.type,
        description: scale.description,
        content: contentJson,
        is_active: true,
        is_system: true,
        sort_order: index,
        created_by_id: null,
        created_at: now,
        updated_at: now,
      });
    }
  }

  await db('templates')
    .where({ clinic_id: clinicId, category: 'Rating Scales', type: 'assessment' })
    .whereIn('name', STALE_LEGACY_SCALE_NAMES)
    .del();

  await db('clinical_templates')
    .where({ clinic_id: clinicId, type: 'assessment' })
    .whereIn('name', STALE_LEGACY_SCALE_NAMES)
    .del();
}

async function run(): Promise<void> {
  const clinics = await db('clinics').where({ is_active: true }).whereNull('deleted_at').select('id', 'name').orderBy('name', 'asc');

  console.log(`Seeding enterprise rating scales for ${clinics.length} clinics...`);
  for (const clinic of clinics) {
    const categoryId = await ensureRatingScaleCategory(clinic.id);
    await upsertTemplatesForClinic(clinic.id, categoryId);
    console.log(`  ✓ ${clinic.name}: ${SCALE_CATALOG.length} rating scales upserted`);
  }

  console.log('Enterprise rating scale seeding complete.');
}

run()
  .then(async () => {
    clearPoolMonitor();
    await db.destroy();
    await appPoolRaw.destroy();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    clearPoolMonitor();
    await db.destroy();
    await appPoolRaw.destroy();
    process.exit(1);
  });

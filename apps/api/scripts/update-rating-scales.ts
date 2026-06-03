import { Client } from 'pg';

const client = new Client({
  host: 'localhost',
  port: 5432,
  user: 'signacare',
  password: 'signacare',
  database: 'signacareemr',
});

interface ScaleUpdate {
  name: string;
  content: unknown[];
}

const scales: ScaleUpdate[] = [
  // ─────────────────────────────────────────────────────────
  // 1. HDRS — Hamilton Depression Rating Scale (17 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'HDRS (Hamilton Depression Rating Scale)',
    content: [
      { type: 'heading', text: 'Hamilton Depression Rating Scale (HDRS-17)' },
      { type: 'instruction', text: 'Rate each item based on the clinical interview. For items scored 0-4, use the full range. For items scored 0-2, use only those values. The total score is the sum of all 17 items.' },
      {
        type: 'likert', label: '1. Depressed Mood (sadness, hopeless, helpless, worthless)', min: 0, max: 4,
        options: ['Absent (0)', 'Indicated only on questioning (1)', 'Spontaneously reported verbally (2)', 'Communicated non-verbally (3)', 'Patient reports virtually only these feelings (4)']
      },
      {
        type: 'likert', label: '2. Feelings of Guilt', min: 0, max: 4,
        options: ['Absent (0)', 'Self-reproach, feels they have let people down (1)', 'Ideas of guilt or rumination over past errors (2)', 'Present illness is a punishment; delusions of guilt (3)', 'Hears accusatory or denunciatory voices; experiences threatening visual hallucinations (4)']
      },
      {
        type: 'likert', label: '3. Suicide', min: 0, max: 4,
        options: ['Absent (0)', 'Feels life is not worth living (1)', 'Wishes they were dead or any thoughts of death (2)', 'Suicidal ideas or gestures (3)', 'Attempts at suicide (4)']
      },
      {
        type: 'likert', label: '4. Insomnia — Early (difficulty falling asleep)', min: 0, max: 2,
        options: ['No difficulty (0)', 'Occasional difficulty falling asleep, more than half an hour (1)', 'Nightly difficulty falling asleep (2)']
      },
      {
        type: 'likert', label: '5. Insomnia — Middle (complaints of being restless during night)', min: 0, max: 2,
        options: ['No difficulty (0)', 'Patient complains of being restless and disturbed during the night (1)', 'Waking during the night — getting out of bed (2)']
      },
      {
        type: 'likert', label: '6. Insomnia — Late (waking in early hours and unable to fall asleep again)', min: 0, max: 2,
        options: ['No difficulty (0)', 'Waking in early hours but goes back to sleep (1)', 'Unable to fall asleep again if gets out of bed (2)']
      },
      {
        type: 'likert', label: '7. Work and Activities', min: 0, max: 4,
        options: ['No difficulty (0)', 'Feelings of incapacity, fatigue or weakness; activities, work or hobbies (1)', 'Loss of interest in activities, hobbies or work — reported directly by patient or by listlessness, indecision and vacillation (2)', 'Decrease in actual time spent in activities or decrease in productivity (3)', 'Stopped working because of present illness (4)']
      },
      {
        type: 'likert', label: '8. Retardation (slowness of thought and speech; impaired ability to concentrate; decreased motor activity)', min: 0, max: 4,
        options: ['Normal speech and thought (0)', 'Slight retardation during the interview (1)', 'Obvious retardation during the interview (2)', 'Interview difficult (3)', 'Complete stupor (4)']
      },
      {
        type: 'likert', label: '9. Agitation', min: 0, max: 4,
        options: ['None (0)', 'Fidgetiness (1)', 'Playing with hands, hair, etc. (2)', 'Moving about, cannot sit still (3)', 'Hand wringing, nail biting, hair pulling, biting of lips (4)']
      },
      {
        type: 'likert', label: '10. Anxiety — Psychic', min: 0, max: 4,
        options: ['No difficulty (0)', 'Subjective tension and irritability (1)', 'Worrying about minor matters (2)', 'Apprehensive attitude apparent in face or speech (3)', 'Fears expressed without questioning (4)']
      },
      {
        type: 'likert', label: '11. Anxiety — Somatic (GI, CV, respiratory, urinary, sweating)', min: 0, max: 4,
        options: ['Absent (0)', 'Mild (1)', 'Moderate (2)', 'Severe (3)', 'Incapacitating (4)']
      },
      {
        type: 'likert', label: '12. Somatic Symptoms — Gastrointestinal (appetite, food, stomach)', min: 0, max: 2,
        options: ['None (0)', 'Loss of appetite, but eating without encouragement; heavy feelings in abdomen (1)', 'Difficulty eating without urging; requests or requires laxatives or medication for GI symptoms (2)']
      },
      {
        type: 'likert', label: '13. Somatic Symptoms — General (heaviness in limbs, back, head; diffuse backache; loss of energy and fatigability)', min: 0, max: 2,
        options: ['None (0)', 'Heaviness in limbs, back or head; backaches, headache, muscle aches; loss of energy and fatigability (1)', 'Any clear-cut symptom rates 2 (2)']
      },
      {
        type: 'likert', label: '14. Genital Symptoms (loss of libido, impaired sexual performance, menstrual disturbances)', min: 0, max: 2,
        options: ['Absent (0)', 'Mild (1)', 'Severe (2)']
      },
      {
        type: 'likert', label: '15. Hypochondriasis', min: 0, max: 4,
        options: ['Not present (0)', 'Self-absorption (bodily) (1)', 'Preoccupation with health (2)', 'Frequent complaints, requests for help (3)', 'Hypochondriacal delusions (4)']
      },
      {
        type: 'likert', label: '16. Loss of Weight (rate either A or B)', min: 0, max: 2,
        options: ['No weight loss (0)', 'Probable weight loss associated with present illness (1)', 'Definite (according to patient) weight loss (2)']
      },
      {
        type: 'likert', label: '17. Insight', min: 0, max: 2,
        options: ['Acknowledges being depressed and ill (0)', 'Acknowledges illness but attributes cause to bad food, climate, overwork, virus, need for rest, etc. (1)', 'Denies being ill at all (2)']
      },
      {
        type: 'score', label: 'Total HDRS-17 Score', formula: 'sum',
        ranges: [
          { min: 0, max: 7, label: 'Normal' },
          { min: 8, max: 13, label: 'Mild Depression' },
          { min: 14, max: 18, label: 'Moderate Depression' },
          { min: 19, max: 22, label: 'Severe Depression' },
          { min: 23, max: 52, label: 'Very Severe Depression' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 2. YMRS — Young Mania Rating Scale (11 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'YMRS (Young Mania Rating Scale)',
    content: [
      { type: 'heading', text: 'Young Mania Rating Scale (YMRS)' },
      { type: 'instruction', text: 'Rate each item based on the patient\'s subjective report of their condition over the previous 48 hours and on your clinical observation during the interview. Items 5, 6, 8, and 9 are weighted (scored 0-8); all others are scored 0-4.' },
      {
        type: 'likert', label: '1. Elevated Mood', min: 0, max: 4,
        options: ['Absent (0)', 'Mildly or possibly increased on questioning (1)', 'Definite subjective elevation; optimistic, self-confident; cheerful; appropriate to content (2)', 'Elevated; inappropriate to content; humorous (3)', 'Euphoric; inappropriate laughter; singing (4)']
      },
      {
        type: 'likert', label: '2. Increased Motor Activity/Energy', min: 0, max: 4,
        options: ['Absent (0)', 'Subjectively increased (1)', 'Animated; gestures increased (2)', 'Excessive energy; hyperactive at times; restless but can be calmed (3)', 'Motor excitement; continuous hyperactivity; cannot be calmed (4)']
      },
      {
        type: 'likert', label: '3. Sexual Interest', min: 0, max: 4,
        options: ['Normal; not increased (0)', 'Mildly or possibly increased (1)', 'Definite subjective increase on questioning (2)', 'Spontaneous sexual content; elaborates on sexual matters; hypersexual by self-report (3)', 'Overt sexual acts (towards patients, staff, or interviewer) (4)']
      },
      {
        type: 'likert', label: '4. Sleep', min: 0, max: 4,
        options: ['Reports no decrease in sleep (0)', 'Sleeping less than normal amount by up to one hour (1)', 'Sleeping less than normal by more than one hour (2)', 'Reports decreased need for sleep (3)', 'Denies need for sleep (4)']
      },
      {
        type: 'likert', label: '5. Irritability', min: 0, max: 8,
        options: ['Absent (0)', '', 'Subjectively increased (2)', '', 'Irritable at times during interview; recent episodes of anger or annoyance on ward (4)', '', 'Frequently irritable during interview; short and curt throughout (6)', '', 'Hostile, uncooperative; interview impossible (8)']
      },
      {
        type: 'likert', label: '6. Speech (Rate / Amount)', min: 0, max: 8,
        options: ['No increase (0)', '', 'Feels talkative (2)', '', 'Increased rate or amount at times; verbose at times (4)', '', 'Push; consistently increased rate and amount; difficult to interrupt (6)', '', 'Pressured; uninterruptible; continuous speech (8)']
      },
      {
        type: 'likert', label: '7. Language — Thought Disorder', min: 0, max: 4,
        options: ['Absent (0)', 'Circumstantial; mild distractibility; quick thoughts (1)', 'Distractible; loses goal of thought; changes topics frequently; racing thoughts (2)', 'Flight of ideas; tangentiality; difficult to follow; rhyming; echolalia (3)', 'Incoherent; communication impossible (4)']
      },
      {
        type: 'likert', label: '8. Content', min: 0, max: 8,
        options: ['Normal (0)', '', 'Questionable plans; new interests (2)', '', 'Special project(s); hyperreligious (4)', '', 'Grandiose or paranoid ideas; ideas of reference (6)', '', 'Delusions; hallucinations (8)']
      },
      {
        type: 'likert', label: '9. Disruptive — Aggressive Behaviour', min: 0, max: 8,
        options: ['Absent, cooperative (0)', '', 'Sarcastic; loud at times; guarded (2)', '', 'Demanding; threats on ward (4)', '', 'Threatens interviewer; shouting; interview difficult (6)', '', 'Assaultive; destructive; interview impossible (8)']
      },
      {
        type: 'likert', label: '10. Appearance', min: 0, max: 4,
        options: ['Appropriate dress and grooming (0)', 'Minimally unkempt (1)', 'Poorly groomed; moderately dishevelled; overdressed (2)', 'Dishevelled; partly clothed; garish make-up (3)', 'Completely unkempt; decorated; bizarre garb (4)']
      },
      {
        type: 'likert', label: '11. Insight', min: 0, max: 4,
        options: ['Present; admits illness; agrees with need for treatment (0)', 'Possibly ill (1)', 'Admits behaviour change but denies illness (2)', 'Admits possible change in behaviour but denies illness (3)', 'Denies any behaviour change (4)']
      },
      {
        type: 'score', label: 'Total YMRS Score', formula: 'sum',
        ranges: [
          { min: 0, max: 7, label: 'Remission' },
          { min: 8, max: 14, label: 'Mild Mania' },
          { min: 15, max: 25, label: 'Moderate Mania' },
          { min: 26, max: 60, label: 'Severe Mania' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 3. PHQ-9 — Patient Health Questionnaire (9 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'PHQ-9 (Patient Health Questionnaire)',
    content: [
      { type: 'heading', text: 'Patient Health Questionnaire (PHQ-9)' },
      { type: 'instruction', text: 'Over the last 2 weeks, how often have you been bothered by any of the following problems?' },
      {
        type: 'likert', label: '1. Little interest or pleasure in doing things', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '2. Feeling down, depressed, or hopeless', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '3. Trouble falling or staying asleep, or sleeping too much', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '4. Feeling tired or having little energy', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '5. Poor appetite or overeating', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '6. Feeling bad about yourself — or that you are a failure or have let yourself or your family down', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '7. Trouble concentrating on things, such as reading the newspaper or watching television', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '8. Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '9. Thoughts that you would be better off dead, or of hurting yourself in some way', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'score', label: 'Total PHQ-9 Score', formula: 'sum',
        ranges: [
          { min: 0, max: 4, label: 'Minimal Depression' },
          { min: 5, max: 9, label: 'Mild Depression' },
          { min: 10, max: 14, label: 'Moderate Depression' },
          { min: 15, max: 19, label: 'Moderately Severe Depression' },
          { min: 20, max: 27, label: 'Severe Depression' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 4. GAD-7 — Generalised Anxiety Disorder (7 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'GAD-7 (Generalised Anxiety Disorder)',
    content: [
      { type: 'heading', text: 'Generalised Anxiety Disorder Assessment (GAD-7)' },
      { type: 'instruction', text: 'Over the last 2 weeks, how often have you been bothered by the following problems?' },
      {
        type: 'likert', label: '1. Feeling nervous, anxious, or on edge', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '2. Not being able to stop or control worrying', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '3. Worrying too much about different things', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '4. Trouble relaxing', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '5. Being so restless that it is hard to sit still', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '6. Becoming easily annoyed or irritable', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'likert', label: '7. Feeling afraid, as if something awful might happen', min: 0, max: 3,
        options: ['Not at all (0)', 'Several days (1)', 'More than half the days (2)', 'Nearly every day (3)']
      },
      {
        type: 'score', label: 'Total GAD-7 Score', formula: 'sum',
        ranges: [
          { min: 0, max: 4, label: 'Minimal Anxiety' },
          { min: 5, max: 9, label: 'Mild Anxiety' },
          { min: 10, max: 14, label: 'Moderate Anxiety' },
          { min: 15, max: 21, label: 'Severe Anxiety' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 5. GAF — Global Assessment of Functioning (slider 1-100)
  // ─────────────────────────────────────────────────────────
  {
    name: 'GAF (Global Assessment of Functioning)',
    content: [
      { type: 'heading', text: 'Global Assessment of Functioning (GAF)' },
      { type: 'instruction', text: 'Consider psychological, social, and occupational functioning on a hypothetical continuum of mental health-illness. Do not include impairment in functioning due to physical or environmental limitations. Use the reference guide below, then rate the patient on the slider.' },
      {
        type: 'text_block',
        text: '91-100: Superior functioning in a wide range of activities; life\'s problems never seem to get out of hand; is sought out by others because of many positive qualities. No symptoms.\n\n81-90: Absent or minimal symptoms (e.g., mild anxiety before an exam); good functioning in all areas; interested and involved in a wide range of activities; socially effective; generally satisfied with life; no more than everyday problems or concerns.\n\n71-80: If symptoms are present, they are transient and expectable reactions to psychosocial stressors (e.g., difficulty concentrating after family argument); no more than slight impairment in social, occupational, or school functioning.\n\n61-70: Some mild symptoms (e.g., depressed mood and mild insomnia) OR some difficulty in social, occupational, or school functioning, but generally functioning pretty well; has some meaningful interpersonal relationships.\n\n51-60: Moderate symptoms (e.g., flat affect and circumstantial speech, occasional panic attacks) OR moderate difficulty in social, occupational, or school functioning (e.g., few friends, conflicts with peers or co-workers).\n\n41-50: Serious symptoms (e.g., suicidal ideation, severe obsessional rituals, frequent shoplifting) OR any serious impairment in social, occupational, or school functioning (e.g., no friends, unable to keep a job).\n\n31-40: Some impairment in reality testing or communication (e.g., speech is at times illogical, obscure, or irrelevant) OR major impairment in several areas, such as work or school, family relations, judgement, thinking, or mood.\n\n21-30: Behaviour is considerably influenced by delusions or hallucinations OR serious impairment in communication or judgement (e.g., sometimes incoherent, acts grossly inappropriately, suicidal preoccupation) OR inability to function in almost all areas.\n\n11-20: Some danger of hurting self or others (e.g., suicide attempts without clear expectation of death; frequently violent; manic excitement) OR occasionally fails to maintain minimal personal hygiene OR gross impairment in communication.\n\n1-10: Persistent danger of severely hurting self or others (e.g., recurrent violence) OR persistent inability to maintain minimal personal hygiene OR serious suicidal act with clear expectation of death.'
      },
      { type: 'likert', label: 'Current GAF Score', min: 1, max: 100 },
      {
        type: 'score', label: 'GAF Rating', formula: 'sum',
        ranges: [
          { min: 1, max: 10, label: 'Persistent danger / inability to function' },
          { min: 11, max: 20, label: 'Some danger to self/others' },
          { min: 21, max: 30, label: 'Serious impairment in communication/judgement' },
          { min: 31, max: 40, label: 'Major impairment in several areas' },
          { min: 41, max: 50, label: 'Serious symptoms' },
          { min: 51, max: 60, label: 'Moderate symptoms' },
          { min: 61, max: 70, label: 'Mild symptoms' },
          { min: 71, max: 80, label: 'Slight impairment' },
          { min: 81, max: 90, label: 'Absent/minimal symptoms' },
          { min: 91, max: 100, label: 'Superior functioning' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 6. BPRS — Brief Psychiatric Rating Scale (18 items, 1-7 slider)
  // ─────────────────────────────────────────────────────────
  {
    name: 'BPRS (Brief Psychiatric Rating Scale)',
    content: [
      { type: 'heading', text: 'Brief Psychiatric Rating Scale (BPRS-18)' },
      { type: 'instruction', text: 'Rate each symptom on a scale of 1 (not present) to 7 (extremely severe) based on observation and patient report. Use the slider for each item. 1 = Not present, 2 = Very mild, 3 = Mild, 4 = Moderate, 5 = Moderately severe, 6 = Severe, 7 = Extremely severe.' },
      { type: 'likert', label: '1. Somatic Concern — preoccupation with physical health, fear of physical illness, hypochondriasis', min: 1, max: 7 },
      { type: 'likert', label: '2. Anxiety — worry, fear, over-concern for present or future, uneasiness', min: 1, max: 7 },
      { type: 'likert', label: '3. Emotional Withdrawal — lack of spontaneous interaction, isolation, deficiency in relating to others', min: 1, max: 7 },
      { type: 'likert', label: '4. Conceptual Disorganisation — thought processes confused, disconnected, disorganised, disrupted', min: 1, max: 7 },
      { type: 'likert', label: '5. Guilt Feelings — self-blame, shame, remorse for past behaviour', min: 1, max: 7 },
      { type: 'likert', label: '6. Tension — physical and motor manifestations of nervousness, over-activation', min: 1, max: 7 },
      { type: 'likert', label: '7. Mannerisms and Posturing — peculiar, bizarre, unnatural motor behaviour', min: 1, max: 7 },
      { type: 'likert', label: '8. Grandiosity — exaggerated self-opinion, arrogance, conviction of unusual power or abilities', min: 1, max: 7 },
      { type: 'likert', label: '9. Depressive Mood — sorrow, sadness, despondency, pessimism', min: 1, max: 7 },
      { type: 'likert', label: '10. Hostility — animosity, contempt, belligerence, disdain for others', min: 1, max: 7 },
      { type: 'likert', label: '11. Suspiciousness — mistrust, belief others harbour malicious or discriminatory intent', min: 1, max: 7 },
      { type: 'likert', label: '12. Hallucinatory Behaviour — perceptions without normal external stimulus correspondence', min: 1, max: 7 },
      { type: 'likert', label: '13. Motor Retardation — slowed, weakened movements or speech, reduced body tone', min: 1, max: 7 },
      { type: 'likert', label: '14. Uncooperativeness — resistance, guardedness, rejection of authority', min: 1, max: 7 },
      { type: 'likert', label: '15. Unusual Thought Content — unusual, odd, strange, bizarre thought content', min: 1, max: 7 },
      { type: 'likert', label: '16. Blunted Affect — reduced emotional tone, reduction in formal intensity of feelings, flatness', min: 1, max: 7 },
      { type: 'likert', label: '17. Excitement — heightened emotional tone, agitation, increased reactivity', min: 1, max: 7 },
      { type: 'likert', label: '18. Disorientation — confusion or lack of proper association for person, place, or time', min: 1, max: 7 },
      {
        type: 'score', label: 'Total BPRS Score', formula: 'sum',
        ranges: [
          { min: 18, max: 31, label: 'Not ill / Very mildly ill' },
          { min: 32, max: 40, label: 'Mildly ill' },
          { min: 41, max: 52, label: 'Moderately ill' },
          { min: 53, max: 65, label: 'Markedly ill' },
          { min: 66, max: 88, label: 'Severely ill' },
          { min: 89, max: 126, label: 'Extremely ill' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 7. K10 — Kessler Psychological Distress Scale (10 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'K10 (Kessler Psychological Distress)',
    content: [
      { type: 'heading', text: 'Kessler Psychological Distress Scale (K10)' },
      { type: 'instruction', text: 'In the past 4 weeks, about how often did you feel...' },
      {
        type: 'likert', label: '1. ...tired out for no good reason?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '2. ...nervous?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '3. ...so nervous that nothing could calm you down?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '4. ...hopeless?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '5. ...restless or fidgety?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '6. ...so restless you could not sit still?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '7. ...depressed?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '8. ...that everything was an effort?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '9. ...so sad that nothing could cheer you up?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'likert', label: '10. ...worthless?', min: 1, max: 5,
        options: ['None of the time (1)', 'A little of the time (2)', 'Some of the time (3)', 'Most of the time (4)', 'All of the time (5)']
      },
      {
        type: 'score', label: 'Total K10 Score', formula: 'sum',
        ranges: [
          { min: 10, max: 15, label: 'Low Distress — likely to be well' },
          { min: 16, max: 21, label: 'Moderate Distress — likely to have a mild disorder' },
          { min: 22, max: 29, label: 'High Distress — likely to have a moderate disorder' },
          { min: 30, max: 50, label: 'Very High Distress — likely to have a severe disorder' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 8. PANSS — Positive and Negative Syndrome Scale
  // ─────────────────────────────────────────────────────────
  {
    name: 'PANSS (Positive and Negative Syndrome)',
    content: [
      { type: 'heading', text: 'Positive and Negative Syndrome Scale (PANSS)' },
      { type: 'instruction', text: 'Rate each item from 1 (absent) to 7 (extreme) based on clinical interview and observation. Use the slider for each item. 1 = Absent, 2 = Minimal, 3 = Mild, 4 = Moderate, 5 = Moderate-Severe, 6 = Severe, 7 = Extreme.' },

      { type: 'heading', text: 'Positive Scale' },
      { type: 'likert', label: 'P1. Delusions — beliefs which are unfounded, unrealistic, and idiosyncratic', min: 1, max: 7 },
      { type: 'likert', label: 'P2. Conceptual Disorganisation — disorganised process of thinking characterised by disruption of goal-directed sequencing', min: 1, max: 7 },
      { type: 'likert', label: 'P3. Hallucinatory Behaviour — verbal report or behaviour indicating perceptions not generated by external stimuli', min: 1, max: 7 },
      { type: 'likert', label: 'P4. Excitement — hyperactivity as reflected in accelerated motor behaviour, heightened responsivity, hypervigilance, or excessive mood lability', min: 1, max: 7 },
      { type: 'likert', label: 'P5. Grandiosity — exaggerated self-opinion and unrealistic convictions of superiority', min: 1, max: 7 },
      { type: 'likert', label: 'P6. Suspiciousness/Persecution — unrealistic or exaggerated ideas of persecution', min: 1, max: 7 },
      { type: 'likert', label: 'P7. Hostility — verbal and non-verbal expressions of anger and resentment', min: 1, max: 7 },

      { type: 'heading', text: 'Negative Scale' },
      { type: 'likert', label: 'N1. Blunted Affect — diminished emotional responsiveness as characterised by a reduction in facial expression, modulation of feelings, and communicative gestures', min: 1, max: 7 },
      { type: 'likert', label: 'N2. Emotional Withdrawal — lack of interest in, involvement with, and affective commitment to life\'s events', min: 1, max: 7 },
      { type: 'likert', label: 'N3. Poor Rapport — lack of interpersonal empathy, openness in conversation, and sense of closeness, interest, or involvement with the interviewer', min: 1, max: 7 },
      { type: 'likert', label: 'N4. Passive/Apathetic Social Withdrawal — diminished interest and initiative in social interactions due to passivity, apathy, anergy, or avolition', min: 1, max: 7 },
      { type: 'likert', label: 'N5. Difficulty in Abstract Thinking — impairment in the use of the abstract-symbolic mode of thinking', min: 1, max: 7 },
      { type: 'likert', label: 'N6. Lack of Spontaneity and Flow of Conversation — reduction in the normal flow of communication associated with apathy, avolition, defensiveness, or cognitive deficit', min: 1, max: 7 },
      { type: 'likert', label: 'N7. Stereotyped Thinking — decreased fluidity, spontaneity, and flexibility of thinking, as evidenced in rigid, repetitious, or barren thought content', min: 1, max: 7 },

      {
        type: 'score', label: 'PANSS Positive + Negative Total', formula: 'sum',
        ranges: [
          { min: 14, max: 28, label: 'Absent to Minimal symptoms' },
          { min: 29, max: 42, label: 'Mild symptoms' },
          { min: 43, max: 56, label: 'Moderate symptoms' },
          { min: 57, max: 70, label: 'Moderate-Severe symptoms' },
          { min: 71, max: 84, label: 'Severe symptoms' },
          { min: 85, max: 98, label: 'Extreme symptoms' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 9. MADRS — Montgomery-Asberg Depression Rating Scale (10 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'MADRS (Montgomery-Asberg Depression)',
    content: [
      { type: 'heading', text: 'Montgomery-Asberg Depression Rating Scale (MADRS)' },
      { type: 'instruction', text: 'Rate each item on a 0-6 scale based on the clinical interview, where 0 = no abnormality and 6 = most severe. Odd numbers (1, 3, 5) represent intermediate ratings when the clinician judges the severity falls between two defined levels.' },
      {
        type: 'likert', label: '1. Apparent Sadness — representing despondency, gloom and despair (more than just ordinary transient low spirits), reflected in speech, facial expression, and posture', min: 0, max: 6,
        options: ['No sadness (0)', '(1)', 'Looks dispirited but brightens up without difficulty (2)', '(3)', 'Appears sad and unhappy most of the time (4)', '(5)', 'Looks miserable all the time; extremely despondent (6)']
      },
      {
        type: 'likert', label: '2. Reported Sadness — representing reports of depressed mood, regardless of whether it is reflected in appearance. Includes low spirits, despondency, or the feeling of being beyond help and without hope', min: 0, max: 6,
        options: ['Occasional sadness in keeping with the circumstances (0)', '(1)', 'Sad or low but brightens up without difficulty (2)', '(3)', 'Pervasive feelings of sadness or gloominess (4)', '(5)', 'Continuous or unvarying sadness, misery, or despondency (6)']
      },
      {
        type: 'likert', label: '3. Inner Tension — representing feelings of ill-defined discomfort, edginess, inner turmoil, mental tension mounting to either panic, dread, or anguish', min: 0, max: 6,
        options: ['Placid; only fleeting inner tension (0)', '(1)', 'Occasional feelings of edginess and ill-defined discomfort (2)', '(3)', 'Continuous feelings of inner tension or intermittent panic which the patient can only master with some difficulty (4)', '(5)', 'Unrelenting dread or anguish; overwhelming panic (6)']
      },
      {
        type: 'likert', label: '4. Reduced Sleep — representing the experience of reduced duration or depth of sleep compared to the subject\'s own normal pattern when well', min: 0, max: 6,
        options: ['Sleeps as usual (0)', '(1)', 'Slight difficulty dropping off to sleep or slightly reduced, light, or fitful sleep (2)', '(3)', 'Sleep reduced or broken by at least two hours (4)', '(5)', 'Less than two or three hours of sleep (6)']
      },
      {
        type: 'likert', label: '5. Reduced Appetite — representing the feeling of a loss of appetite compared with when well. Rate by loss of desire for food or the need to force oneself to eat', min: 0, max: 6,
        options: ['Normal or increased appetite (0)', '(1)', 'Slightly reduced appetite (2)', '(3)', 'No appetite; food is tasteless (4)', '(5)', 'Needs persuasion to eat at all (6)']
      },
      {
        type: 'likert', label: '6. Concentration Difficulties — representing difficulties in collecting one\'s thoughts mounting to incapacitating lack of concentration', min: 0, max: 6,
        options: ['No difficulties in concentrating (0)', '(1)', 'Occasional difficulties in collecting one\'s thoughts (2)', '(3)', 'Difficulties in concentrating and sustaining thought which reduces ability to read or hold a conversation (4)', '(5)', 'Unable to read or converse without great difficulty (6)']
      },
      {
        type: 'likert', label: '7. Lassitude — representing difficulty in getting started or slowness in initiating and performing everyday activities', min: 0, max: 6,
        options: ['Hardly any difficulty in getting started; no sluggishness (0)', '(1)', 'Difficulties in starting activities (2)', '(3)', 'Difficulties in starting simple routine activities which are carried out with effort (4)', '(5)', 'Complete lassitude; unable to do anything without help (6)']
      },
      {
        type: 'likert', label: '8. Inability to Feel — representing the subjective experience of reduced interest in the surroundings, or activities that normally give pleasure', min: 0, max: 6,
        options: ['Normal interest in the surroundings and in other people (0)', '(1)', 'Reduced ability to enjoy usual interests (2)', '(3)', 'Loss of interest in the surroundings; loss of feelings for friends and acquaintances (4)', '(5)', 'The experience of being emotionally paralysed, inability to feel anger, grief, or pleasure, and a complete or even painful failure to feel for close relatives and friends (6)']
      },
      {
        type: 'likert', label: '9. Pessimistic Thoughts — representing thoughts of guilt, inferiority, self-reproach, sinfulness, remorse, and ruin', min: 0, max: 6,
        options: ['No pessimistic thoughts (0)', '(1)', 'Fluctuating ideas of failure, self-reproach, or self-depreciation (2)', '(3)', 'Persistent self-accusations, or definite but still rational ideas of guilt or sin; increasingly pessimistic about the future (4)', '(5)', 'Delusions of ruin, remorse, or unredeemable sin; self-accusations which are absurd and unshakeable (6)']
      },
      {
        type: 'likert', label: '10. Suicidal Thoughts — representing the feeling that life is not worth living, that a natural death would be welcome, suicidal thoughts, and preparations for suicide', min: 0, max: 6,
        options: ['Enjoys life or takes it as it comes (0)', '(1)', 'Weary of life; only fleeting suicidal thoughts (2)', '(3)', 'Probably better off dead; suicidal thoughts are common, and suicide is considered as a possible solution, but without specific plans or intention (4)', '(5)', 'Explicit plans for suicide when there is an opportunity; active preparations for suicide (6)']
      },
      {
        type: 'score', label: 'Total MADRS Score', formula: 'sum',
        ranges: [
          { min: 0, max: 6, label: 'Normal / Symptom absent' },
          { min: 7, max: 19, label: 'Mild Depression' },
          { min: 20, max: 34, label: 'Moderate Depression' },
          { min: 35, max: 60, label: 'Severe Depression' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 10. AUDIT — Alcohol Use Disorders Identification Test (10 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'AUDIT (Alcohol Use Disorders)',
    content: [
      { type: 'heading', text: 'Alcohol Use Disorders Identification Test (AUDIT)' },
      { type: 'instruction', text: 'Answer each question about your alcohol use. One standard drink is equivalent to 10g of pure alcohol (e.g., 285 mL regular beer, 100 mL wine, 30 mL spirits). Please answer as accurately as possible.' },
      {
        type: 'likert', label: '1. How often do you have a drink containing alcohol?', min: 0, max: 4,
        options: ['Never (0)', 'Monthly or less (1)', '2-4 times a month (2)', '2-3 times a week (3)', '4 or more times a week (4)']
      },
      {
        type: 'likert', label: '2. How many standard drinks do you have on a typical day when you are drinking?', min: 0, max: 4,
        options: ['1 or 2 (0)', '3 or 4 (1)', '5 or 6 (2)', '7 to 9 (3)', '10 or more (4)']
      },
      {
        type: 'likert', label: '3. How often do you have 6 or more standard drinks on one occasion?', min: 0, max: 4,
        options: ['Never (0)', 'Less than monthly (1)', 'Monthly (2)', 'Weekly (3)', 'Daily or almost daily (4)']
      },
      {
        type: 'likert', label: '4. How often during the last year have you found that you were not able to stop drinking once you had started?', min: 0, max: 4,
        options: ['Never (0)', 'Less than monthly (1)', 'Monthly (2)', 'Weekly (3)', 'Daily or almost daily (4)']
      },
      {
        type: 'likert', label: '5. How often during the last year have you failed to do what was normally expected of you because of drinking?', min: 0, max: 4,
        options: ['Never (0)', 'Less than monthly (1)', 'Monthly (2)', 'Weekly (3)', 'Daily or almost daily (4)']
      },
      {
        type: 'likert', label: '6. How often during the last year have you needed a first drink in the morning to get yourself going after a heavy drinking session?', min: 0, max: 4,
        options: ['Never (0)', 'Less than monthly (1)', 'Monthly (2)', 'Weekly (3)', 'Daily or almost daily (4)']
      },
      {
        type: 'likert', label: '7. How often during the last year have you had a feeling of guilt or remorse after drinking?', min: 0, max: 4,
        options: ['Never (0)', 'Less than monthly (1)', 'Monthly (2)', 'Weekly (3)', 'Daily or almost daily (4)']
      },
      {
        type: 'likert', label: '8. How often during the last year have you been unable to remember what happened the night before because of your drinking?', min: 0, max: 4,
        options: ['Never (0)', 'Less than monthly (1)', 'Monthly (2)', 'Weekly (3)', 'Daily or almost daily (4)']
      },
      {
        type: 'likert', label: '9. Have you or someone else been injured because of your drinking?', min: 0, max: 4,
        options: ['No (0)', '', 'Yes, but not in the last year (2)', '', 'Yes, during the last year (4)']
      },
      {
        type: 'likert', label: '10. Has a relative, friend, doctor, or other health care worker been concerned about your drinking or suggested you cut down?', min: 0, max: 4,
        options: ['No (0)', '', 'Yes, but not in the last year (2)', '', 'Yes, during the last year (4)']
      },
      {
        type: 'score', label: 'Total AUDIT Score', formula: 'sum',
        ranges: [
          { min: 0, max: 7, label: 'Low Risk' },
          { min: 8, max: 15, label: 'Hazardous Drinking' },
          { min: 16, max: 19, label: 'Harmful Drinking' },
          { min: 20, max: 40, label: 'Possible Dependence' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 11. DAST-10 — Drug Abuse Screening Test (10 yes/no items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'DAST-10 (Drug Abuse Screening Test)',
    content: [
      { type: 'heading', text: 'Drug Abuse Screening Test (DAST-10)' },
      { type: 'instruction', text: 'The following questions concern information about your potential involvement with drugs, excluding alcohol and tobacco, during the past 12 months. "Drug abuse" refers to (1) the use of prescribed or over-the-counter drugs in excess of the directions and (2) any non-medical use of drugs. Answer each question Yes or No.' },
      { type: 'yes_no', label: '1. Have you used drugs other than those required for medical reasons?' },
      { type: 'yes_no', label: '2. Do you abuse more than one drug at a time?' },
      { type: 'yes_no', label: '3. Are you always able to stop using drugs when you want to? (If Yes, score 0; if No, score 1)' },
      { type: 'yes_no', label: '4. Have you had "blackouts" or "flashbacks" as a result of drug use?' },
      { type: 'yes_no', label: '5. Do you ever feel bad or guilty about your drug use?' },
      { type: 'yes_no', label: '6. Does your spouse (or parents) ever complain about your involvement with drugs?' },
      { type: 'yes_no', label: '7. Have you neglected your family because of your use of drugs?' },
      { type: 'yes_no', label: '8. Have you engaged in illegal activities in order to obtain drugs?' },
      { type: 'yes_no', label: '9. Have you ever experienced withdrawal symptoms (felt sick) when you stopped taking drugs?' },
      { type: 'yes_no', label: '10. Have you had medical problems as a result of your drug use (e.g., memory loss, hepatitis, convulsions, bleeding)?' },
      {
        type: 'score', label: 'Total DAST-10 Score', formula: 'sum',
        ranges: [
          { min: 0, max: 0, label: 'No problems reported' },
          { min: 1, max: 2, label: 'Low Level — monitor and reassess' },
          { min: 3, max: 5, label: 'Moderate Level — further investigation' },
          { min: 6, max: 8, label: 'Substantial Level — intensive assessment' },
          { min: 9, max: 10, label: 'Severe Level — intensive assessment and treatment' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 12. MMSE — Mini Mental State Examination (11 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'MMSE (Mini Mental State Examination)',
    content: [
      { type: 'heading', text: 'Mini Mental State Examination (MMSE)' },
      { type: 'instruction', text: 'Administer each section and record the score obtained. The maximum total score is 30. Score each item according to the number of correct responses.' },

      { type: 'heading', text: 'Orientation' },
      {
        type: 'likert', label: '1. Orientation to Time — Ask: What is the (year)? (season)? (date)? (day)? (month)? (1 point each)', min: 0, max: 5,
        options: ['0 correct (0)', '1 correct (1)', '2 correct (2)', '3 correct (3)', '4 correct (4)', '5 correct (5)']
      },
      {
        type: 'likert', label: '2. Orientation to Place — Ask: Where are we? (state/country)? (city/town)? (hospital/building)? (floor/level)? (street address/suburb)? (1 point each)', min: 0, max: 5,
        options: ['0 correct (0)', '1 correct (1)', '2 correct (2)', '3 correct (3)', '4 correct (4)', '5 correct (5)']
      },

      { type: 'heading', text: 'Registration' },
      {
        type: 'likert', label: '3. Registration — Name 3 objects (e.g., apple, table, penny). Ask the patient to repeat all 3. Give 1 point for each correct answer on the first attempt. Repeat until all 3 are learned (up to 6 trials) for later recall test.', min: 0, max: 3,
        options: ['0 correct (0)', '1 correct (1)', '2 correct (2)', '3 correct (3)']
      },

      { type: 'heading', text: 'Attention and Calculation' },
      {
        type: 'likert', label: '4. Attention and Calculation — Serial 7s: Ask the patient to begin with 100 and count backwards by 7. Stop after 5 subtractions (93, 86, 79, 72, 65). Score 1 point for each correct answer. Alternative: spell "WORLD" backwards (D-L-R-O-W).', min: 0, max: 5,
        options: ['0 correct (0)', '1 correct (1)', '2 correct (2)', '3 correct (3)', '4 correct (4)', '5 correct (5)']
      },

      { type: 'heading', text: 'Recall' },
      {
        type: 'likert', label: '5. Recall — Ask the patient to recall the 3 objects from Registration (1 point each)', min: 0, max: 3,
        options: ['0 correct (0)', '1 correct (1)', '2 correct (2)', '3 correct (3)']
      },

      { type: 'heading', text: 'Language' },
      {
        type: 'likert', label: '6. Naming — Show the patient a wristwatch and ask what it is. Repeat for a pencil. (1 point each)', min: 0, max: 2,
        options: ['0 correct (0)', '1 correct (1)', '2 correct (2)']
      },
      {
        type: 'likert', label: '7. Repetition — Ask the patient to repeat: "No ifs, ands, or buts"', min: 0, max: 1,
        options: ['Incorrect (0)', 'Correct (1)']
      },
      {
        type: 'likert', label: '8. 3-Stage Command — Give the patient a plain piece of paper and say: "Take the paper in your right hand, fold it in half, and put it on the floor." (1 point for each part correctly executed)', min: 0, max: 3,
        options: ['0 correct (0)', '1 correct (1)', '2 correct (2)', '3 correct (3)']
      },
      {
        type: 'likert', label: '9. Reading — Show the patient a card with "CLOSE YOUR EYES" written on it. Ask them to read and do what it says. Score 1 point if eyes are closed.', min: 0, max: 1,
        options: ['Incorrect (0)', 'Correct (1)']
      },
      {
        type: 'likert', label: '10. Writing — Ask the patient to write a sentence. It must contain a subject and verb and be sensible. Correct grammar and punctuation are not necessary.', min: 0, max: 1,
        options: ['Incorrect/No sentence (0)', 'Correct sentence (1)']
      },
      {
        type: 'likert', label: '11. Copying — Ask the patient to copy two intersecting pentagons (each side approximately 2.5 cm). All 10 angles must be present and 2 must intersect to score 1 point. Tremor and rotation are ignored.', min: 0, max: 1,
        options: ['Incorrect (0)', 'Correct (1)']
      },
      {
        type: 'score', label: 'Total MMSE Score', formula: 'sum',
        ranges: [
          { min: 0, max: 9, label: 'Severe Cognitive Impairment' },
          { min: 10, max: 18, label: 'Moderate Cognitive Impairment' },
          { min: 19, max: 23, label: 'Mild Cognitive Impairment' },
          { min: 24, max: 30, label: 'No Cognitive Impairment' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 13. HoNOS — Health of the Nation Outcome Scales (12 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'HoNOS (Health of the Nation Outcome Scales)',
    content: [
      { type: 'heading', text: 'Health of the Nation Outcome Scales (HoNOS)' },
      { type: 'instruction', text: 'Rate each item for the most severe problem that occurred during the rating period (usually the past 2 weeks). Use the scale: 0 = No problem, 1 = Minor problem requiring no action, 2 = Mild problem but definitely present, 3 = Moderately severe problem, 4 = Severe to very severe problem.' },

      { type: 'heading', text: 'Behaviour' },
      {
        type: 'likert', label: '1. Overactive, aggressive, disruptive or agitated behaviour', min: 0, max: 4,
        options: ['No problem (0)', 'Minor problem requiring no action (1)', 'Mild but definitely present (e.g., occasionally aggressive, irritable) (2)', 'Moderately severe (e.g., aggressive gestures, pushing, harassing) (3)', 'Severe to very severe (e.g., violence, needing restraint) (4)']
      },
      {
        type: 'likert', label: '2. Non-accidental self-injury', min: 0, max: 4,
        options: ['No problem (0)', 'Minor problem requiring no action (e.g., fleeting thoughts) (1)', 'Mild but definitely present (e.g., deliberate self-harm, risk to self) (2)', 'Moderately severe (e.g., suicidal intent, deliberate self-harm) (3)', 'Severe to very severe (e.g., serious suicide attempt, serious self-injury) (4)']
      },
      {
        type: 'likert', label: '3. Problem drinking or drug-taking', min: 0, max: 4,
        options: ['No problem (0)', 'Minor problem requiring no action (1)', 'Mild but definitely present (e.g., some excess, within social norms) (2)', 'Moderately severe (e.g., loss of control, intoxication, impaired functioning) (3)', 'Severe to very severe (e.g., constant intoxication, incapacitated, serious consequences) (4)']
      },

      { type: 'heading', text: 'Impairment' },
      {
        type: 'likert', label: '4. Cognitive problems (memory, orientation, understanding)', min: 0, max: 4,
        options: ['No problem (0)', 'Minor problem (e.g., occasional forgetfulness) (1)', 'Mild but definitely present (e.g., some confusion, some memory difficulty) (2)', 'Moderately severe (e.g., marked disorientation in time/place/person, difficulty with new information) (3)', 'Severe to very severe (e.g., unable to recall name, unable to learn) (4)']
      },
      {
        type: 'likert', label: '5. Physical illness or disability problems', min: 0, max: 4,
        options: ['No problem (0)', 'Minor health problem (1)', 'Mild but definitely present (e.g., physical health problem limits some activities) (2)', 'Moderately severe (e.g., moderate disability, moderate limitation of activity) (3)', 'Severe to very severe (e.g., severe disability, severe or complete incapacity) (4)']
      },

      { type: 'heading', text: 'Clinical Problems' },
      {
        type: 'likert', label: '6. Problems associated with hallucinations and delusions', min: 0, max: 4,
        options: ['No problem (0)', 'Minor/occasional odd beliefs (1)', 'Mild but definitely present (e.g., hallucinations/delusions present but limited distress/behaviour disturbance) (2)', 'Moderately severe (e.g., preoccupied with hallucinations/delusions, some distress/disturbance) (3)', 'Severe to very severe (e.g., mental state and behaviour seriously and adversely affected) (4)']
      },
      {
        type: 'likert', label: '7. Problems with depressed mood', min: 0, max: 4,
        options: ['No problem (0)', 'Minor gloomy moods (1)', 'Mild but definitely present (e.g., definite depressed mood, some guilt, loss of self-esteem) (2)', 'Moderately severe (e.g., markedly depressed, preoccupied with guilt/hopelessness) (3)', 'Severe to very severe (e.g., severely depressed, delusional guilt, suicidal) (4)']
      },
      {
        type: 'likert', label: '8. Other mental and behavioural problems (specify type: A=phobic, B=anxiety, C=obsessive-compulsive, D=mental strain/tension, E=dissociative, F=somatoform, G=eating, H=sleep, I=sexual, J=other)', min: 0, max: 4,
        options: ['No problem (0)', 'Minor problem requiring no action (1)', 'Mild but definitely present (e.g., a problem is present but the patient retains some degree of control) (2)', 'Moderately severe (e.g., a marked problem, patient has limited control) (3)', 'Severe to very severe (e.g., a major problem dominating the patient\'s activities) (4)']
      },

      { type: 'heading', text: 'Social Problems' },
      {
        type: 'likert', label: '9. Problems with relationships', min: 0, max: 4,
        options: ['No significant problem (0)', 'Minor non-clinical problem (1)', 'Mild but definite problem (e.g., an active but troubled relationship) (2)', 'Moderately severe (e.g., persistent major problems due to active or passive withdrawal, or relationships with limited or no quality) (3)', 'Severe to very severe (e.g., near total or total social isolation) (4)']
      },
      {
        type: 'likert', label: '10. Problems with activities of daily living (self-care, basic activities)', min: 0, max: 4,
        options: ['No problem (0)', 'Minor problem only (e.g., untidy, disorganised) (1)', 'Mild but definite problem (e.g., limited self-care, needs some prompting) (2)', 'Moderately severe (e.g., limited competence in basic skills, needs some assistance with self-care) (3)', 'Severe to very severe (e.g., severe disability or incapacity in all or nearly all areas of daily living) (4)']
      },
      {
        type: 'likert', label: '11. Problems with living conditions', min: 0, max: 4,
        options: ['Accommodation and living conditions are acceptable (0)', 'Minor problem only (1)', 'Mild but definite problem (e.g., some pressure to move, or basic amenities lacking) (2)', 'Moderately severe (e.g., serious threat of eviction, problems with housing suitability) (3)', 'Severe to very severe (e.g., homeless, or living conditions are otherwise intolerable) (4)']
      },
      {
        type: 'likert', label: '12. Problems with occupation and activities (quality of daytime environment)', min: 0, max: 4,
        options: ['No problem (0)', 'Minor problem only (1)', 'Mild but definite problem (e.g., limited participation, some difficulty with planned activities) (2)', 'Moderately severe (e.g., marked deficit in services, or in useful occupation) (3)', 'Severe to very severe (e.g., almost no daytime activities of any kind available) (4)']
      },
      {
        type: 'score', label: 'Total HoNOS Score', formula: 'sum',
        ranges: [
          { min: 0, max: 9, label: 'Low severity' },
          { min: 10, max: 18, label: 'Moderate severity' },
          { min: 19, max: 32, label: 'High severity' },
          { min: 33, max: 48, label: 'Very high severity' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 14. PSS — Perceived Stress Scale (10 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'PSS (Perceived Stress Scale)',
    content: [
      { type: 'heading', text: 'Perceived Stress Scale (PSS-10)' },
      { type: 'instruction', text: 'The questions in this scale ask about your feelings and thoughts during the last month. In each case, indicate how often you felt or thought a certain way.' },
      {
        type: 'likert', label: '1. In the last month, how often have you been upset because of something that happened unexpectedly?', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '2. In the last month, how often have you felt that you were unable to control the important things in your life?', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '3. In the last month, how often have you felt nervous and stressed?', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '4. In the last month, how often have you felt confident about your ability to handle your personal problems? (reverse scored)', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '5. In the last month, how often have you felt that things were going your way? (reverse scored)', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '6. In the last month, how often have you found that you could not cope with all the things that you had to do?', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '7. In the last month, how often have you been able to control irritations in your life? (reverse scored)', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '8. In the last month, how often have you felt that you were on top of things? (reverse scored)', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '9. In the last month, how often have you been angered because of things that were outside of your control?', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'likert', label: '10. In the last month, how often have you felt difficulties were piling up so high that you could not overcome them?', min: 0, max: 4,
        options: ['Never (0)', 'Almost never (1)', 'Sometimes (2)', 'Fairly often (3)', 'Very often (4)']
      },
      {
        type: 'score', label: 'Total PSS Score', formula: 'sum',
        ranges: [
          { min: 0, max: 13, label: 'Low Stress' },
          { min: 14, max: 26, label: 'Moderate Stress' },
          { min: 27, max: 40, label: 'High Perceived Stress' },
        ]
      },
    ],
  },

  // ─────────────────────────────────────────────────────────
  // 15. CGI — Clinical Global Impression (2 items)
  // ─────────────────────────────────────────────────────────
  {
    name: 'CGI (Clinical Global Impression)',
    content: [
      { type: 'heading', text: 'Clinical Global Impression (CGI)' },
      { type: 'instruction', text: 'Rate the patient\'s illness severity and degree of change from baseline. This scale is completed by the clinician.' },
      {
        type: 'likert', label: 'CGI-S: Severity of Illness — Considering your total clinical experience with this particular population, how mentally ill is the patient at this time?', min: 1, max: 7,
        options: ['Normal, not at all ill (1)', 'Borderline mentally ill (2)', 'Mildly ill (3)', 'Moderately ill (4)', 'Markedly ill (5)', 'Severely ill (6)', 'Among the most extremely ill patients (7)']
      },
      {
        type: 'likert', label: 'CGI-I: Global Improvement — Compared to the patient\'s condition at admission/baseline, how much has the patient changed?', min: 1, max: 7,
        options: ['Very much improved (1)', 'Much improved (2)', 'Minimally improved (3)', 'No change (4)', 'Minimally worse (5)', 'Much worse (6)', 'Very much worse (7)']
      },
      {
        type: 'score', label: 'CGI Summary', formula: 'sum',
        ranges: [
          { min: 2, max: 4, label: 'Minimal severity / Much improved' },
          { min: 5, max: 8, label: 'Mild to Moderate' },
          { min: 9, max: 11, label: 'Marked to Severe' },
          { min: 12, max: 14, label: 'Extremely severe / Much worse' },
        ]
      },
    ],
  },
];

async function main() {
  await client.connect();
  console.log('Connected to database.');

  let updated = 0;
  let errors = 0;

  for (const scale of scales) {
    try {
      const result = await client.query(
        `UPDATE templates SET content = $1::jsonb, updated_at = NOW() WHERE name = $2 AND type = 'rating_scale'`,
        [JSON.stringify(scale.content), scale.name]
      );
      if (result.rowCount === 1) {
        console.log(`  Updated: ${scale.name} (${scale.content.length} fields)`);
        updated++;
      } else {
        console.log(`  WARNING: No matching template found for "${scale.name}"`);
        errors++;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR updating "${scale.name}": ${message}`);
      errors++;
    }
  }

  console.log(`\nDone. Updated: ${updated}, Errors: ${errors}`);

  // Verify
  const verify = await client.query(
    `SELECT name, jsonb_array_length(content) as field_count FROM templates WHERE type = 'rating_scale' ORDER BY name`
  );
  console.log('\nVerification — field counts per template:');
  for (const row of verify.rows) {
    console.log(`  ${row.name}: ${row.field_count} fields`);
  }

  await client.end();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

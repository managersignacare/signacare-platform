import { db } from './db/db'

const ALERT_TYPES = [
  {
    name: 'Aggression and Violence Risk',
    severity: 'high',
    color: '#D32F2F',
    plan_template: `AGGRESSION & VIOLENCE MANAGEMENT PLAN

1. RISK LEVEL: [ ] Low  [ ] Medium  [ ] High  [ ] Extreme

2. KNOWN TRIGGERS:
-
-

3. WARNING SIGNS:
- Early:
- Escalating:
- Imminent:

4. DE-ESCALATION STRATEGIES:
- Verbal:
- Environmental:
- PRN Medication:

5. RESPONSE PLAN:
- If verbal aggression:
- If physical aggression:
- Code Grey activation threshold:
- Seclusion/restraint considerations (MH Act s115):

6. SAFE ENGAGEMENT:
- Recommended staffing level for contact:
- Home visit: [ ] Safe with precautions  [ ] Dual clinician only  [ ] Not recommended
- Interview setting: [ ] Open area  [ ] Near exit  [ ] Duress alarm required

7. REVIEW DATE: ____/____/________
8. PLAN AUTHORED BY:
`,
  },
  {
    name: 'Carried Weapons History',
    severity: 'critical',
    color: '#B71C1C',
    plan_template: `WEAPONS RISK MANAGEMENT PLAN

1. KNOWN WEAPON TYPE(S):
2. LAST KNOWN INCIDENT DATE:
3. CONTEXT OF WEAPON USE/POSSESSION:

4. SAFETY MEASURES:
- Home visit protocol: [ ] Not recommended  [ ] Police escort required  [ ] Dual clinician with safety plan
- Search/screening: [ ] Metal detector on admission  [ ] Bag check
- Clinical environment: [ ] Remove sharps from area  [ ] Security presence

5. NOTIFICATION:
- Victoria Police notified: [ ] Yes  [ ] No  Date:
- Risk flag on LEAP: [ ] Yes  [ ] No

6. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Suicide Risk',
    severity: 'critical',
    color: '#D32F2F',
    plan_template: `SUICIDE RISK SAFETY PLAN

1. CURRENT RISK LEVEL: [ ] Low  [ ] Moderate  [ ] High  [ ] Extreme

2. WARNING SIGNS (thoughts, mood, behaviour, situations):
-
-

3. INTERNAL COPING STRATEGIES (things I can do without others):
-
-

4. PEOPLE & SOCIAL SETTINGS THAT PROVIDE DISTRACTION:
- Name: _____________ Phone: _____________
- Name: _____________ Phone: _____________
- Places:

5. PEOPLE I CAN ASK FOR HELP:
- Name: _____________ Phone: _____________
- Name: _____________ Phone: _____________

6. PROFESSIONALS & CRISIS SERVICES:
- Treating clinician: _____________ Phone: _____________
- Crisis team / CATT:
- Lifeline: 13 11 14
- Suicide Call Back Service: 1300 659 467
- 000 (Emergency)

7. MEANS RESTRICTION:
- Lethal means identified:
- Steps to restrict access:
- Person responsible for securing means:

8. REASONS FOR LIVING:
-
-

9. NEXT REVIEW DATE: ____/____/________
10. CLINICIAN: ________________  PATIENT SIGNATURE: ________________
`,
  },
  {
    name: 'Self-Harm Risk',
    severity: 'high',
    color: '#E65100',
    plan_template: `SELF-HARM MANAGEMENT PLAN

1. METHOD(S) OF SELF-HARM:
2. FREQUENCY: [ ] Rare  [ ] Occasional  [ ] Frequent  [ ] Daily
3. TRIGGERS:
-

4. ALTERNATIVE COPING STRATEGIES:
-
-

5. WOUND CARE INSTRUCTIONS:
-

6. ENVIRONMENTAL SAFETY (inpatient):
- [ ] Remove ligature points  [ ] Sharps restricted  [ ] Observation level: ___

7. ESCALATION PLAN:
- If self-harm occurs:
- Medical review threshold:

8. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Absconding Risk',
    severity: 'high',
    color: '#F57C00',
    plan_template: `ABSCONDING RISK MANAGEMENT PLAN

1. RISK LEVEL: [ ] Low  [ ] Medium  [ ] High

2. HISTORY OF ABSCONDING:
- Previous events:
- Known destinations when absent:

3. PREVENTION:
- Observation level: [ ] General  [ ] Close  [ ] 1:1  [ ] Within arms length
- Leave status (MH Act): [ ] No leave  [ ] Supervised only  [ ] Ground leave
- Environmental: [ ] Locked ward  [ ] Door alarms  [ ] CCTV monitoring

4. IF PATIENT ABSCONDS:
- Immediate notification: [ ] Nurse in charge  [ ] Consultant  [ ] Family  [ ] Police
- Missing person threshold (hours): ___
- Known locations to check:

5. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'DVA / Deep Vein Thrombosis Risk',
    severity: 'medium',
    color: '#F0852C',
    plan_template: `DVT RISK MANAGEMENT PLAN

1. RISK FACTORS: [ ] Immobility  [ ] Clozapine  [ ] Obesity  [ ] Smoking  [ ] Previous DVT  [ ] Other: ___

2. PREVENTION:
- [ ] Anti-embolism stockings (TED)
- [ ] Regular mobilisation encouraged
- [ ] Adequate hydration
- [ ] Pharmacological prophylaxis: ___

3. MONITORING:
- [ ] Daily calf assessment
- [ ] Report leg swelling/pain immediately

4. ESCALATION:
- If symptoms: Urgent medical review + D-dimer + Doppler USS

5. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Home Visit Safety Alert',
    severity: 'high',
    color: '#E65100',
    plan_template: `HOME VISIT SAFETY PLAN

1. RISK(S) IDENTIFIED AT ADDRESS:
- [ ] History of aggression  [ ] Weapons  [ ] Dogs  [ ] Drug use  [ ] Unsafe structure
- Other:

2. VISIT PROTOCOL:
- [ ] Dual clinician required
- [ ] Notify team before and after visit
- [ ] Police escort required
- [ ] Visit in car park / public space only
- [ ] Do not enter premises — doorstep only
- [ ] Phone contact preferred — no home visit

3. VEHICLE:
- [ ] Park facing exit direction  [ ] Keep engine running  [ ] Have phone accessible

4. CHECK-IN PROCESS:
- Call team at: _______ (start)  Expected duration: ___ mins
- If no check-in by: _______ → action:

5. ADDRESS NOTES:
- Parking:
- Entry:
- Who else may be present:

6. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Falls Risk',
    severity: 'medium',
    color: '#F0852C',
    plan_template: `FALLS PREVENTION PLAN

1. RISK FACTORS: [ ] Age >65  [ ] Sedating medication  [ ] Gait instability  [ ] Postural hypotension  [ ] Previous falls

2. PREVENTION:
- [ ] Non-slip footwear  [ ] Bed rails  [ ] Low bed  [ ] Mobility aid
- [ ] Toilet schedule  [ ] Night light  [ ] Falls mat
- Medication review (sedation):

3. POST-FALL PROTOCOL:
- Neurological observations if head strike
- Incident report (VHIMS/RiskMan)

4. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Metabolic Syndrome Risk',
    severity: 'medium',
    color: '#F0852C',
    plan_template: `METABOLIC MONITORING PLAN

1. ANTIPSYCHOTIC: _____________ DOSE: _____________

2. BASELINE MEASURES:
- Weight: ___kg  BMI: ___  Waist: ___cm
- BP: ___/___  Fasting glucose: ___  HbA1c: ___
- Lipids: TC ___ / TG ___ / HDL ___ / LDL ___

3. MONITORING SCHEDULE:
- Weight: Monthly for 3 months then quarterly
- Bloods (FBG, Lipids, HbA1c): 3-monthly for first year then 6-monthly
- BP: Each visit
- Waist: Quarterly

4. LIFESTYLE INTERVENTIONS:
- [ ] Dietitian referral  [ ] Exercise physiology referral
- [ ] Smoking cessation support  [ ] Healthy eating program

5. ESCALATION:
- If weight gain >7%: Review antipsychotic, consider switch
- If FBG >6.0 or HbA1c >5.7: GP referral for diabetes screening

6. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Allergy Alert',
    severity: 'high',
    color: '#D32F2F',
    plan_template: `ALLERGY ALERT

1. ALLERGEN:
2. REACTION TYPE: [ ] Anaphylaxis  [ ] Rash  [ ] Angioedema  [ ] GI  [ ] Other: ___
3. SEVERITY: [ ] Mild  [ ] Moderate  [ ] Severe/Anaphylaxis
4. DATE OF REACTION:
5. MANAGEMENT:
- Avoid:
- EpiPen prescribed: [ ] Yes  [ ] No  Location: ___
- Alternative medications:
`,
  },
  {
    name: 'Restrictive Intervention History',
    severity: 'high',
    color: '#E65100',
    plan_template: `RESTRICTIVE INTERVENTION PREVENTION PLAN (MH Act Div 6)

1. HISTORY OF RESTRICTIVE INTERVENTIONS:
- Seclusion: [ ] Yes — last date: ___  [ ] No
- Restraint: [ ] Yes — last date: ___  [ ] No
- Bodily restraint: [ ] Yes  [ ] No

2. KNOWN ANTECEDENTS:
-

3. PREFERRED DE-ESCALATION:
- Patient's stated preferences:
- Sensory strategies:
- PRN medication preference:

4. ADVANCE STATEMENT (MH Act s19):
- [ ] Advance statement on file  [ ] Not completed
- Key requests:

5. NOMINATED PERSON:
- Name: _____________ Phone: _____________

6. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Child Protection Concerns',
    severity: 'high',
    color: '#D32F2F',
    plan_template: `CHILD SAFETY ALERT

1. CHILDREN IN HOUSEHOLD:
- Name: _____________ Age: ___
- Name: _____________ Age: ___

2. CONCERNS:
-

3. CHILD PROTECTION NOTIFICATION:
- DFFH notified: [ ] Yes  [ ] No  Date: ___  Reference: ___
- MARAM assessment completed: [ ] Yes  [ ] No

4. SAFETY PLAN:
-

5. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Family Violence Risk',
    severity: 'high',
    color: '#D32F2F',
    plan_template: `FAMILY VIOLENCE SAFETY PLAN (MARAM Framework)

1. RISK LEVEL (MARAM): [ ] At risk  [ ] Elevated risk  [ ] Serious risk

2. VICTIM/SURVIVOR:
- Is patient the: [ ] Victim  [ ] Person using violence  [ ] Both

3. IF PATIENT IS VICTIM:
- Safe contact method:
- Safe word/code:
- Safety exit plan discussed: [ ] Yes  [ ] No
- Safe at Home referral: [ ] Yes  [ ] No

4. IF PATIENT IS PERSON USING VIOLENCE:
- Men's Referral Service: 1300 766 491
- Behaviour change program referral: [ ] Yes  [ ] No

5. INFORMATION SHARING (FVISS):
- Prescribed entities notified:

6. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Elopement Risk (Community)',
    severity: 'medium',
    color: '#F0852C',
    plan_template: `COMMUNITY ELOPEMENT PLAN

1. RISK OF DISENGAGEMENT: [ ] Low  [ ] Medium  [ ] High

2. ASSERTIVE FOLLOW-UP PLAN:
- If missed appointment: Contact within ___ hours
- If unreachable for ___ days: Home visit / welfare check
- Police welfare check threshold: ___ days

3. KEY CONTACTS:
- NOK: _____________ Phone: _____________
- GP: _____________ Phone: _____________

4. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Clozapine Monitoring Alert',
    severity: 'high',
    color: '#E65100',
    plan_template: `CLOZAPINE MONITORING ALERT

1. CURRENT DOSE: ___mg  BRAND: [ ] Clopine  [ ] Clozaril
2. MONITORING SERVICE: [ ] Clopine Care  [ ] Clozaril Care Plus
3. BLOOD MONITORING:
- Frequency: [ ] Weekly  [ ] Fortnightly  [ ] Monthly  [ ] 4-weekly
- Last WCC/ANC: Date: ___ WCC: ___ ANC: ___

4. KEY RISKS:
- [ ] Neutropenia  [ ] Myocarditis (first 6 weeks)  [ ] Ileus/constipation  [ ] Metabolic
- Troponin/CRP baseline done: [ ] Yes  [ ] No

5. CONSTIPATION MANAGEMENT:
- Bowel chart: [ ] Active
- Laxative regimen:

6. ESCALATION:
- ANC <1.5: Interrupt clozapine + urgent haematology review
- Fever + tachycardia in first 6 weeks: Urgent troponin + CRP

7. REVIEW DATE: ____/____/________
`,
  },
  {
    name: 'Infection Control Alert',
    severity: 'medium',
    color: '#F0852C',
    plan_template: `INFECTION CONTROL ALERT

1. INFECTION/CONDITION:
2. PRECAUTIONS: [ ] Standard  [ ] Contact  [ ] Droplet  [ ] Airborne
3. PPE REQUIRED:
4. ISOLATION: [ ] Yes — room: ___  [ ] No

5. REVIEW DATE: ____/____/________
`,
  },
]

async function seed() {
  const [clinic] = await db('clinics').select('id').limit(1)
  const clinicId = clinic.id

  for (let i = 0; i < ALERT_TYPES.length; i++) {
    const a = ALERT_TYPES[i]
    const existing = await db('alert_types').where({ clinic_id: clinicId, name: a.name }).first()
    if (!existing) {
      await db('alert_types').insert({
        id: db.raw('gen_random_uuid()'),
        clinic_id: clinicId,
        name: a.name,
        severity: a.severity,
        color: a.color,
        plan_template: a.plan_template,
        is_active: true,
        sort_order: i,
        created_at: new Date(),
        updated_at: new Date(),
      })
    }
  }
  console.log('Alert types seeded:', ALERT_TYPES.length)
  await db.destroy()
}

seed().catch(e => { console.error('Error:', e); process.exit(1) })

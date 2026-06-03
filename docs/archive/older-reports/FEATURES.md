# Signacare EMR — Comprehensive Features Reference

**Version:** 2.0
**Last Updated:** 11 April 2026
**Scope:** Features only. This document is an exhaustive, export-ready reference of every capability currently implemented in the Signacare EMR platform. It excludes bug reports, audit findings, gap analyses, and roadmap content.
**Audience:** Clinical leads, procurement, integration partners, onboarding teams, and external stakeholders who need a complete picture of what the product does.

---

## Table of Contents

1. [Clinical Workflows & Patient Management](#1-clinical-workflows--patient-management)
2. [Medication Management](#2-medication-management)
3. [Mental Health Act & Legal](#3-mental-health-act--legal)
4. [Inpatient Care](#4-inpatient-care)
5. [Assessments & Outcome Measures](#5-assessments--outcome-measures)
6. [Physical Health Monitoring](#6-physical-health-monitoring)
7. [Appointments & Scheduling](#7-appointments--scheduling)
8. [Case Management & Care Planning](#8-case-management--care-planning)
9. [Receptionist & Administrative Workflows](#9-receptionist--administrative-workflows)
10. [Reporting & Analytics](#10-reporting--analytics)
11. [Security & Access Control](#11-security--access-control)
12. [AI & Clinical Intelligence](#12-ai--clinical-intelligence)
13. [Interoperability & Integration](#13-interoperability--integration)
14. [Compliance & Regulatory](#14-compliance--regulatory)
15. [Deployment & Operations](#15-deployment--operations)
16. [Configuration & Customisation](#16-configuration--customisation)
17. [Staffing & Team Management](#17-staffing--team-management)
18. [Communication & Messaging](#18-communication--messaging)
19. [Advanced Clinical Features](#19-advanced-clinical-features)
20. [System Features & Infrastructure](#20-system-features--infrastructure)
21. [Feature Module Index](#21-feature-module-index)

---

## 1. Clinical Workflows & Patient Management

### Core Patient Management
- **Patient Demographics**: Full registration capturing given and family name, preferred name, date of birth, gender identity, pronouns, Indigenous status, preferred language, interpreter requirement, photo, residential and postal addresses, multiple phone numbers and email addresses.
- **Healthcare Identifiers**: Medicare number, IHI (Individual Healthcare Identifier), DVA number, and local EMR/MRN — encrypted at the application layer using AES-256-GCM with pgcrypto so identifiers never sit in plain text.
- **Patient Search**: Weighted full-text search (name, MRN, Medicare, phone) with trigram-based fuzzy/typo-tolerant matching for variant spellings.
- **Duplicate Detection (Identity Management)**: Multi-signal matcher that combines deterministic identifier lookups (Medicare / IHI / DVA via blind-index HMAC columns — no decryption required) with fuzzy trigram name matching, DOB exact plus off-by-one day, phone, and address. Confidence buckets (definite / strong / probable) let the registration wizard warn on likely matches before they become duplicates. Blocks strong and definite duplicates at create time with `409 DUPLICATE_PATIENT`. Partial unique indexes at the database layer reject a second active patient with the same identifier even if the application layer forgets.
- **Patient Merge (Admin)**: Admin or superadmin can merge a source patient into a destination with a mandatory ≥10-character reason. The merge soft-deletes the source, records an immutable JSONB snapshot in `patient_merges`, and writes a `PATIENT_MERGED` audit entry. Clinical records are not automatically re-pointed — the surviving chart surfaces the merge and clinicians move records deliberately with the Transfer tool. `GET /patients/:id/merges` returns every merge event touching a row.
- **Patient Contacts**: Next of kin, carers, guardians, emergency contacts, and professional contacts with relationship type, contact preferences, and primary/secondary ranking.
- **Patient Flags**: Clinical flags with severity levels (red alert, warning, informational) and visibility rules so critical information surfaces on every patient screen.
- **Patient Alerts**: Active alert banners with auto-escalation pathways, acknowledgement tracking, and clinician-side audit of who saw what when.
- **Patient Allergy & Adverse Reaction Management**: Allergen tracking with reaction type, severity, date of onset, reporter, and drug-allergy conflict checking before prescribing.
- **Patient Photo Capture**: In-app photo capture and upload with secure blob storage.
- **Lived Experience & Peer Narratives**: Dedicated fields for patient-voiced goals, strengths, preferences, and supports.

### Episodes of Care
- **Episode Creation & Closure**: Track treatment episodes with type, referral source, status, team assignment, and primary clinician.
- **Episode Type Configuration**: Clinic-configurable episode types (inpatient, outpatient, day program, crisis, community, consult-liaison).
- **Team Allocation**: Assign patients to clinical teams and individual primary clinicians with history preserved.
- **Episode History**: Longitudinal episode tracking with start/end dates, reason for closure, and outcome.
- **Treatment Plans**: Create and track multi-component treatment plans with goals, interventions, and review cadence.
- **Review Planning**: Schedule, record, and audit clinical review dates and 91-day statutory reviews.
- **Intake Workflow**: Structured intake module for new referrals covering presenting problem, history, risk screen, and triage decision.

### Clinical Documentation
- **Clinical Notes**: Progress notes, ward-round notes, intake assessments, phone consultations, unscheduled contacts, and free-form clinical notes.
- **Note Templates**: Customisable clinical note templates with mandatory sections, auto-population, and clinic-specific categories.
- **Digital Signature Workflow**: Draft → Edit → Sign → Locked, with timestamped signature, provider verification, and immutable signed content.
- **Note Modification Tracking**: Audit trail of all changes; signed notes preserve the original with "amended by" links to subsequent edits.
- **Soft Delete**: Notes are never physically destroyed; deletion is soft-flagged and still accessible for audit.
- **Full-Text Search Within Notes**: Clinicians can search across clinical note content for a given patient or across their caseload.
- **Optimistic Concurrency**: ETag-based concurrency control prevents silent overwrites when two clinicians edit the same note.
- **Draft Queue**: Personal drafts page collects unsigned notes, voice-memo transcripts, and ambient scribe outputs awaiting review.
- **Keyboard Quick-Insert Macros**: Alt+Shift+P/R/O/V/M/A shortcuts pull pathology, risk, outcomes, vitals, medications, and allergies as formatted markdown directly into the SOAP field at the cursor position of whichever section currently has focus. Each snippet carries a provenance citation (`_Source: pathology [abc12345, …] — fetched <iso>_`) so notes built from macro inserts stay traceable back to their source records. Alt+Shift+? opens a help list. Screen readers announce the shortcut list on SOAP-field focus via `aria-describedby`.

### 5P Clinical Formulation
- **Biopsychosocial Formulation**: Structured 5P model (Presenting Problem, Predisposing, Precipitating, Perpetuating, Protective factors).
- **AI-Assisted Generation**: Auto-generate formulations from patient history, risk assessments, and prior notes using local Ollama inference.
- **Template or Free-Text Modes**: Choose between fully-structured section forms and free-text formulations.
- **Formulation History**: Track formulation evolution across episodes with comparison view.

### Risk Assessment & Safety Planning
- **Risk Assessment Forms**: Comprehensive, template-driven risk assessment with severity classification.
- **Safety Plans**: Collaborative safety planning capturing warning signs, internal coping strategies, social supports, professional contacts, and lethal-means restriction.
- **Risk Levels**: Low / Medium / High severity classification with auto-escalation workflows and dashboard surfacing.
- **Self-Harm & Suicide Risk**: Dedicated tracking for suicidality and non-suicidal self-injury with historical progression.
- **Violence & Aggression Risk**: Threat assessment, protective orders, and staff safety flags.
- **Deterioration Alerts**: Auto-alert on high-risk patterns, missed follow-ups, or worsening outcome scores.

### Advance Directives
- **Advance Care Planning Documents**: Capture patient wishes for future care scenarios.
- **Mental Health Advance Directives**: Patient preferences for involuntary treatment including preferred/avoided medications, treating team, and nominated supporters.
- **End-of-Life Planning**: Goals of care, resuscitation status, organ donation preferences, and preferred place of care.

### Contact Records
- **Contact Documentation**: Log every patient–clinician contact (face-to-face, phone, video, secure message).
- **Contact Type**: Distinguish clinical consultations, brief contacts, assessments, case conferences, and indirect contacts.
- **Contact Duration**: Record time spent for activity-based funding (ABF) reporting.
- **Service Delivery Context**: Track whether contact was clinic, home visit, community outreach, or telehealth.
- **Automatic Contact Records**: Key workflow actions (check-in, note sign-off, medication administration) can create contact records automatically.

### Correspondence & Communication
- **GP Letters**: Generate and dispatch clinical summaries to general practitioners.
- **Referral Letters**: Correspondence to specialists with structured clinical context.
- **Discharge Letters**: Comprehensive discharge summaries with diagnoses, medications, follow-up plan, and MHR-ready structure.
- **AI-Assisted Letter Generation**: LLM-assisted drafting from templates using the patient's record.
- **Letter Templates**: Clinic-configurable correspondence templates by letter type.
- **Recipient Tracking**: Track every recipient, delivery channel, and status (sent/delivered/failed).
- **Email and Print**: Send correspondence via secure email, print to PDF, or export to an external system.

---

## 2. Medication Management

### Prescribing
- **Medication Catalogue Search**: Search pharmaceutical database by name, generic, AMT/SNOMED code, form, and strength.
- **Prescription Entry**: Dose, frequency, route, duration, quantity, repeats, PRN indication, and PRN maximum in 24 hours.
- **Prescriber Gating**: Only staff with a valid `prescriber_number` see Prescribe buttons — Prescribe, Discontinue, and LAI/ECT prescription actions are hidden for non-prescribers.
- **AHPRA Registration Validation**: Prescribers must have valid AHPRA registration; expired or missing registration disables prescribing.
- **Drug Interaction Checking**: Real-time checking against the patient's current medications and allergy record.
- **Allergy Alerts**: Modal confirmation required for known allergen conflicts before prescribing proceeds.
- **Duplicate Therapy Detection**: Warns when a second medication in the same class would be prescribed.
- **Medication History**: Full, longitudinal prescription history with start/end dates and reason for change.
- **Discontinue with Reason**: Explicit discontinuation workflow with reason codes and audit.

### Medication Administration Record (MAR)
- **Auto-Population from Prescriptions**: MAR automatically builds itself from active prescriptions — no double-entry.
- **Intelligent Timing Logic**: Frequency codes expand to sensible default times:
  - OD → 08:00
  - BD → 08:00, 20:00
  - TDS → 08:00, 14:00, 22:00
  - QID → 06:00, 12:00, 18:00, 22:00
  - Nocte → 22:00
  - Mane → 08:00
  - PRN → on-demand
- **Administration Recording**: Given / Refused / Withheld / Omitted with time, nurse signature, and reason.
- **Administration Context**: Supervised, self-administered, inpatient, community, or home.
- **Longitudinal MAR View**: 7 / 14 / 30 / 90-day administration history per medication and aggregated per patient.
- **Daily Compliance Reports**: Adherence percentage by patient, ward, and clinician.
- **AI Adherence Summary**: LLM-generated narrative analysis of administration patterns and outliers.
- **Family/Carer Visibility**: Read-only MAR view exposed to mobile app (Zitavi) for consented patients.

### Long-Acting Injectable (LAI) Management
- **LAI Schedule Management**: Create and track LAI injection schedules by medication and interval.
- **Next-Due Calculation**: Auto-compute next injection date based on last administration and interval.
- **Injection Recording**: Site (deltoid/gluteal/ventrogluteal), dose, administrator, date/time.
- **AIMS Assessment**: Integrated extrapyramidal side-effect assessment alongside LAI administrations.
- **Overdue Alerts**: Flag overdue LAIs on the case manager and nursing dashboards.
- **LAI History**: Multi-year longitudinal view of every injection.

### Clozapine Registry & Monitoring
- **Clozapine Registry**: Record initiation date, indication, prescriber, current dose, and titration history.
- **Blood Monitoring Schedule**: WCC (white cell count) and ANC (absolute neutrophil count) tracking with automatic frequency bands based on duration on clozapine.
- **Result Entry**: Store pathology results with dates, values, and traffic-light reference-range interpretation.
- **Compliance Alerts**: Flag patients overdue for monitoring; block prescribing continuation where policy requires.
- **Prescriber Coordination**: Link clozapine prescriber and treating team for oversight.

### Side-Effect & Metabolic Monitoring
- **Monitoring Schedules**: Create side-effect monitoring schedules per medication.
- **Frequency Options**: Weekly, fortnightly, monthly, and quarterly cadences.
- **Next-Due Tracking**: Auto-calculate and alert when monitoring is due or overdue.
- **Metabolic Monitoring**: Weight, BMI, waist circumference, fasting glucose, and lipids tracked against antipsychotic initiation.
- **Side-Effect Recording**: Presence, severity, impact on daily function, and management plan.

---

## 3. Mental Health Act & Legal

### Legal Order Management
- **MHA Order Types**: Detention/inpatient, interim, Community Treatment Orders (CTO), guardianship, emergency orders, and assessment orders.
- **State-Specific Configuration**: Victoria, NSW, Queensland, South Australia, Western Australia, Tasmania, ACT, NT requirement sets.
- **Order Entry**: Order number, authorising clinician, start date, expiry date, scheduled review, and conditions.
- **Order Status**: Active, Revoked, Expired, Superseded with automatic status transitions at expiry.
- **Involuntary Flags**: Patient-wide involuntary / voluntary / CTO status propagates to all relevant workflows.
- **Capacity Assessment**: Document capacity to consent, domains assessed, and legal basis for override.
- **Second Opinion**: Record second-opinion clinician, date, and outcome for involuntary treatments.
- **Tribunal Tracking**: Review dates, hearing outcomes, decisions, orders made or revoked, and legal representation.
- **MHA Reviews**: Scheduled statutory reviews (including 91-day review) with AI-assisted documentation.

### Consent Management
- **Consent Types**: Informed, MHA Involuntary, MHA CTO, Guardian, Emergency, Research, Data Sharing.
- **Consent Recording**: Who consented, consent giver relationship, date, type, conditions, and witness.
- **Treatment-Specific Consent**: Separate consent records for medications, ECT, psychosurgery, restrictive interventions.
- **Revocation**: Withdraw prior consent with date and reason; historical record preserved.
- **Consent Audit Trail**: Complete history of every consent decision attached to the patient timeline.

---

## 4. Inpatient Care

### Bed Management
- **Bed Register**: Every bed with location, ward, bed number, and service type.
- **Bed Movements**: Admission, transfer, and discharge events with bed assignment history.
- **Bed Availability**: Real-time view of Available / Occupied / Out of Service / Reserved.
- **Bed Board**: Visual ward overview showing patients, acuity, observation level, and planned discharges.
- **Discharge Planning Flags**: Beds flagged for upcoming discharge with planned date and destination.

### Structured Observations
- **Observation Levels**: General, 15-minute, 30-minute, hourly, constant (1:1), and 2:1 with clinical rationale.
- **Observation Recording**: Location, mood, behaviour, sleep, risk concerns, and nurse identifier.
- **Time-Stamped Entry**: Precise recording of observation time with delayed-entry flag and reason.
- **Historical Timeline**: Longitudinal view of every observation with colour-coded risk.
- **Escalation Triggers**: Observations indicating deterioration auto-escalate to duty manager.

### NEWS2 (National Early Warning Score)
- **Vital Parameter Entry**: Respiratory rate, SpO₂ (plus scale 1 or 2 for COPD), supplemental O₂, systolic BP, pulse, temperature, level of consciousness (AVPU/ACVPU).
- **Auto-Scoring**: Automatic total calculation with colour-coded severity:
  - Green (0): No action
  - Teal (1–4): Routine monitoring
  - Orange (5–6 or any single parameter = 3): Increased frequency + clinical review
  - Red (7+): Immediate urgent review
- **Escalation Protocol**: Automated alert to ward medical team at orange/red thresholds.
- **NEWS2 History**: Trend graphs over hours, days, and full admission.

### Falls Risk Assessment
- **Multi-Item Checklist**: Age, previous falls, medications, cognitive state, continence, mobility, environment.
- **Automatic Scoring**: Low / Medium / High with clinical guidance.
- **Intervention Planning**: Fall prevention strategies linked to score.
- **Re-Assessment Scheduling**: Automatic reminder intervals based on risk band.

### Fluid Balance
- **Intake Recording**: Oral, IV, nasogastric, subcutaneous in mL with time and source.
- **Output Recording**: Urine, vomit, drain, stool, insensible losses in mL.
- **Net Balance**: Automatic calculation per shift and per 24 hours with trend.
- **Dehydration / Overload Alerts**: Thresholded alerts for sustained imbalance.

### Wound Care
- **Wound Site & Classification**: Location, type (pressure, surgical, traumatic, ulcer), stage.
- **Dimensions**: Length, width, depth, undermining, tunnelling — with photo capture.
- **Wound Characteristics**: Exudate, odour, wound bed, surrounding skin.
- **Treatment Log**: Dressing type, topical agents, cleansing solution, frequency.
- **Healing Trajectory**: Graphical tracking of dimensions over time.
- **Complication Tracking**: Infection, dehiscence, necrosis, and related interventions.

### Shift Handover
- **Outgoing Handover**: Nurses document per-patient handover summary.
- **AI-Assisted Summary**: Generate shift handover draft from the patient's day's notes, observations, and MAR.
- **Patient-Specific Notes**: Individual handover entries attached to each patient record.
- **Incoming Handover View**: Incoming shift sees the previous shift's notes filtered to their assigned patients.
- **ISBAR Format**: Structured Situation / Background / Assessment / Recommendation handover.

### Restrictive Interventions
- **Seclusion**: Start/end times, location, reason, authorising clinician, ongoing review intervals.
- **Physical Restraint**: Type, indication, staff involved, duration, patient response.
- **Chemical Restraint**: PRN medication administered for behaviour with linkage to the MAR.
- **Least Restrictive Attempts**: Document de-escalation before restrictive intervention.
- **Post-Incident Review**: Debrief, patient perspective, and learning for continuous improvement.

---

## 5. Assessments & Outcome Measures

### Assessment Engine
- **Template-Based Assessments**: Build reusable assessment templates with mixed field types (likert, score, multiple choice, free text, headings).
- **Scoring Calculations**: Auto-calculate totals, subscale scores, and banded interpretations.
- **Mandatory Sections**: Enforce completion of critical sections before submission.
- **Occasion Tracking**: Baseline, mid-point, endpoint, and follow-up occasions.
- **Structured Storage**: Responses stored as JSON for analytics and reporting.
- **Template Versioning**: Historical versions preserved so old assessments remain interpretable.

### Outcome Measures
- **HoNOS** — 12-item Health of the Nation Outcome Scale.
- **HoNOS 65+** — older-adult variant.
- **HoNOS CA** — child and adolescent variant.
- **K-10** — Kessler Psychological Distress Scale.
- **LSP-16** — Life Skills Profile.
- **PHQ-9** — depression screening with suicidal ideation alert.
- **GAD-7** — generalised anxiety screening.
- **Recovery Star** — 10-domain recovery outcomes.
- **Engagement Scores**: Therapeutic alliance and engagement tracking.
- **Longitudinal Graphing**: Visual trending of every outcome score across episodes with comparison to baseline.

### ECT Assessments
- **Cognitive**: MMSE, MoCA, orientation, and amnesia assessment.
- **Pre-ECT Nursing**: Vitals, fasting, consent verification, IV access, dentition check.
- **Post-ECT Nursing**: Vitals, confusion level, headache, myalgia, discharge readiness.
- **Pre-ECT Medical**: Clinical presentation, mental state examination, risk review, rating scales.
- **Post-ECT Medical**: Treatment response, side effects, plan modifications.

### Nursing Assessments
- **ADL Independence**: Levels of independence for activities of daily living.
- **Mobility**: Gait, balance, transfer, assistive devices.
- **Skin Integrity**: Pressure area assessment (Braden/Waterlow-style).
- **Nutrition**: Appetite, swallow, weight trend, MST/MUST screening.
- **Sleep**: Quality, disturbance, interventions.

---

## 6. Physical Health Monitoring

### Vital Signs
- **Weight & Height**: Historical chart, BMI calculation with banded colour indicators (green < 25, amber 25–30, red > 30).
- **Blood Pressure**: Systolic/diastolic with hypertensive thresholds.
- **Heart Rate**: Pulse with variability.
- **Waist Circumference**: Central adiposity marker for metabolic risk.
- **Blood Glucose**: Random or fasting, with diabetes monitoring.
- **Temperature, Respirations, SpO₂**: Shared with NEWS2 workflow.

### Longitudinal Physical Health
- **Multi-Parameter Trend View**: All vitals on one chart with date filters.
- **Baseline Comparison**: Highlight deviation from episode baseline.
- **Target Setting**: Configurable targets (weight, BP, HbA1c) with progress bars.
- **Out-of-Range Alerts**: Auto-flag clinically abnormal values.
- **Export**: Share physical health summary with GP or external providers.

### Metabolic Monitoring (Antipsychotic Context)
- **Weight & BMI Trending**: Linked to antipsychotic initiation date for clear before/after comparison.
- **Lifestyle Interventions**: Document advice given, dietitian referrals, and exercise programs.

---

## 7. Appointments & Scheduling

### Booking
- **Calendar View**: Daily, weekly, and monthly calendars with time slots.
- **Clinician & Team Assignment**: Book with individual clinician or team.
- **Appointment Types**: Individual, group, assessment, review, ECT, injection, case conference.
- **Duration Control**: Configurable default durations per appointment type.
- **Recurring Appointments**: Weekly, fortnightly, or monthly recurrences with end conditions.
- **Waitlist Management**: Track time on waitlist with priority levels.
- **DNA / Non-Attendance Tracking**: Reason codes and DNA rate reporting.
- **Group Appointments**: Multi-patient group sessions.

### Check-In
- **Arrival Notification**: Check-in marks the patient as arrived and auto-notifies the clinician via SSE.
- **Wait Time Tracking**: Time-from-arrival displayed for reception and clinician.
- **Check-In Reversal**: Undo accidental check-ins.
- **Reception Filters**: Filter chips (All / Waiting / Arrived / Completed) for reception desk flow.

### Reminders & Telehealth
- **SMS Reminders**: Bulk SMS with delivery tracking and phone-number validation.
- **Reminder Customisation**: Clinic-specific reminder templates.
- **Teams Meeting Integration**: Auto-generate Teams meeting links for telehealth appointments.
- **Outlook Calendar Sync**: Sync to the clinician's Outlook calendar.
- **Virtual Room Links**: Include video links in patient notifications.

---

## 8. Case Management & Care Planning

### Caseload Management
- **Caseload Assignment**: Assign patients to case managers with team membership.
- **RAG Status Dashboard**: Red (overdue contact), Amber (at risk), Green (on track).
- **Contact Frequency Targets**: Expected contact intervals by pathway or risk.
- **Caseload View**: Personal case-manager dashboard filtered to assigned patients only.
- **Overdue Alerts**: Patients overdue for review/contact flagged prominently.

### Care Plans
- **Goal Setting**: Personal, Clinical, Social, Vocational, Housing, Physical Health domains.
- **SMART Goals**: Goal text, target date, priority, success measure.
- **Progress Tracking**: Status chips (Active → In Progress → Achieved → Not Met).
- **Goal Reviews**: Document review dates, modifications, and patient participation.
- **Interventions**: Specific interventions per goal with responsible staff and frequency.
- **Adherence Monitoring**: Intervention completion tracked against plan.

### Treatment Pathways
- **Pathway Selection**: Assign patient to evidence-based pathway (e.g. First-Episode Psychosis, Mood Disorder).
- **Pathway Milestones**: Stage-based milestones with target dates and completion tracking.
- **Pathway-Specific Workflows**: Tailored forms and required assessments per pathway.
- **Progression View**: Visual pathway progress bar.

### Community Resources Directory
- **Resource Search**: Searchable directory of housing, NDIS, employment, crisis, and community services.
- **Category & Location Filters**: Find resources by type and geography.
- **Referral Instructions**: How to refer, eligibility, documents required.
- **Contact Details**: Phone, address, website, hours of operation.

### Planned Transitions
- **Discharge Planning**: Target discharge date, destination, transition services.
- **Transition Type**: Hospital → community, step-down, transfer of care.
- **Follow-Up Planning**: Scheduled post-discharge appointments and contacts.
- **Warm Handover**: Document referral completed to community services or GP.
- **Transition Checklists**: Tasks required before discharge (medications supplied, letter sent, follow-up booked).

---

## 9. Receptionist & Administrative Workflows

### Check-In Workflow
- **Patient Arrival Marking**: Simple check-in interface.
- **Status Indicators**: Visual waiting/arrived/checked-out state.
- **Clinician Notifications**: Auto-alert clinician via SSE on arrival.
- **Walk-In Handling**: Capture unscheduled arrivals and triage.

### Phone Triage
- **Caller Details**: Caller name, phone, relationship to patient.
- **Patient Matching**: Search and link call to patient record.
- **Urgency Classification**: Urgent / Semi-Urgent / Routine.
- **Reason & Triage Notes**: Free-text with structured reason codes.
- **Staff Assignment**: Route to specific clinician or team.
- **Outcome Options**: Message Taken, Called Back, Referred, Escalated, Other.
- **Auto-Task Creation**: "Message Taken" outcomes auto-create tasks in the clinician's queue.
- **Call History**: Recent calls with quick re-contact.

### SMS Campaigns
- **Bulk Reminders**: Send SMS campaigns to patient cohorts.
- **Phone Validation**: Only send to validated mobile numbers.
- **Delivery Tracking**: Per-message delivery status.
- **Message Templates**: Clinic-configurable message content with merge fields.

### Waitlist Management
- **Add to Waitlist**: Reason, priority, requested date.
- **Position Calculation**: Automatic position numbering with priority overrides.
- **Wait Time Estimation**: Estimated wait based on historical throughput.
- **Waitlist Callbacks**: Track offers, acceptances, and declines.

### Today's Schedule
- **Clinician Grouping**: Schedule grouped by clinician with gaps shown.
- **Status Indicators**: On time / Running late / Break.
- **Quick Navigation**: Click-through to patient record or appointment edit.

---

## 10. Reporting & Analytics

### Role-Based Dashboards
- **5 Role-Specific Views**: Clinician, Nursing, Case Manager, Manager, Receptionist.
- **KPI Cards**: Key metrics with sparklines and 7-day trend arrows.
- **Metric Breakdown**: Per-staff breakdown with colour-coded performance.
- **Target Progress Bars**: Visual progress (e.g. 15/20 appointments).
- **Click-Through Navigation**: Every KPI drills through to the underlying records.

### Clinician Dashboard
- My Clinic Today with last-note summaries
- Appointment KPIs (total / completed / pending)
- Open personal tasks
- Open referrals
- Unread messages
- Caseload summary

### Nursing Dashboard
- Observations overdue
- Medication administration compliance
- NEWS2 alerts
- Shift handover tasks and priorities

### Manager Dashboard
- Total patient contacts and trends
- Staff caseload with over/near/ok bands
- DNA rates by clinician and day
- Workload alerts and balancing
- Service statistics (appointments, closures, new referrals)
- Billing and revenue snapshot

### Admin Reports
- **Overview Tab**: Headline metrics.
- **Clinical Activity**: Appointments, notes, assessments, outcomes.
- **Compliance**: MHA order monitoring, consent tracking, incident rates.
- **Workforce**: Utilisation, productivity, leave patterns.

### Report Builder
- **20+ Combinable Metrics**: Clinical (appointments, notes, assessments, outcomes), Operational (DNA, waitlist, billing, workload), Compliance (MHA, consent, breaches), Outcomes (symptoms, functioning, engagement).
- **7 Dimensions**: By Clinician, Team, Day, Week, Month, Episode Type, Location.
- **5 Visualisation Types**: Bar chart, donut, trend line, heatmap, data table.
- **Automatic Trend Detection**: Variance analysis and outlier identification.
- **AI Narrative Insights**: LLM-generated prose analysis of the active report.
- **Export**: CSV, PDF, print-to-file.
- **Scheduled Reports**: Cron-based generation with email delivery.

### Data Surfaces
- **Materialised Views**: `mv_daily_metrics` (nightly refresh) and `mv_staff_caseload` (hourly refresh) with a `refresh_report_views()` function for non-blocking updates.
- **Masked Patient View**: `patients_masked` de-identified view used by reporting so PHI never leaves the reporting sandbox.
- **Aggregated Reporting**: Report Builder operates on aggregated, de-identified data by default.

---

## 11. Security & Access Control

### Authentication
- **JWT HttpOnly Cookies**: `signacare_access` (60-minute access token) and `signacare_refresh` (7-day refresh token), both HttpOnly and never exposed to JavaScript.
- **Multi-Factor Authentication**: TOTP via authenticator app with QR enrolment and single-use backup codes.
- **WebAuthn / FIDO2 (ACSC ML3)**: Full register / verify / login / verify / list / revoke flow with Redis-backed challenges (5-minute TTL), per-credential signature counter, counter-regression detection to block cloned authenticators, and cooperative MFA flag management so removing the last passkey while TOTP is still active does not drop the user below policy.
- **Password Management**: bcrypt hashing (cost 10), enforced strength policy, breach-password check.
- **Session Management**: Max 5 concurrent sessions per user, 60-minute inactivity timeout with 15-minute warning dialog, 75-minute extended timeout during AI Scribe recording, auto-extension on activity.

### Account Security
- **Account Lockout**: 5 failed login attempts → 15-minute lockout.
- **Login Rate Limiting**: 20 login attempts per 15 minutes per IP.
- **Emergency Break-Glass**: Time-limited superadmin override with full audit trail.

### Authorisation & Access Control
- **Role-Based Access Control (RBAC)**: 6 system roles (Superadmin, Admin, Manager, Clinician, Receptionist, Readonly) with 48 granular permissions, enforced at both API and UI layers.
- **Row-Level Security**: 104 PostgreSQL RLS policies on clinic-scoped tables; all application queries run as a non-owner DB role with `app.clinic_id` context variable per request.
- **Prescriber Gating**: Only staff with a `prescriber_number` can access Prescribe buttons, create medication / ECT / LAI prescriptions.
- **Module-Level Access Control**: Access to individual clinical modules can be restricted per staff member.
- **Clinic-Level Scoping**: Every query is scoped to the user's clinic via RLS plus application filters.
- **Team-Based Access**: Optional restriction of patient access to assigned teams.

### Data Protection
- **Encryption at Rest**: Medicare, IHI, DVA, and other identifiers encrypted with AES-256-GCM using pgcrypto at the application layer.
- **Column-Level Encryption**: Additional sensitive PII columns encrypted with per-field keys.
- **Encryption in Transit**: TLS 1.2/1.3 for all external connections, HTTPS mandatory in production, Nginx SSL termination.
- **Masked Views**: `patients_masked` removes identifiers from analytical queries.

### Audit & Compliance
- **Comprehensive Audit Logging**: 329 database triggers across 95+ tables; every INSERT/UPDATE/DELETE logged to `audit_log`.
- **Read Audit Middleware**: Per-patient API reads logged for clinician accountability.
- **Tamper-Evident Audit Log**: SHA-256 hash chain across audit entries.
- **Audit Timeline Replay**: `audit_log_timeline` view for forensic reconstruction per patient, record, or staff member.
- **Soft Delete Everywhere**: `deleted_at` columns preserve all content; deletion is reversible.
- **Data Retention Policies**: Configurable retention rules per table.
- **Audit Log Archival**: `archive_old_audit_logs(months)` supports the 7-year statutory retention window.
- **Breach Register**: `data_breach_log` table tracking severity, reporter, and resolution.

### Network & Request Security
- **CSRF Protection**: X-CSRF-Token header required on all state-changing requests.
- **Tiered Rate Limiting**: General API, Auth, and AI tiers with memory fallback if Redis is unavailable.
- **IP Allowlisting**: Optional CIDR-based `IP_ALLOWLIST` environment variable.
- **Strict CORS**: Origin validation configurable per deployment.
- **Trust Proxy**: X-Forwarded-For extraction behind reverse proxies.
- **Idempotency-Key Middleware**: Clinical write endpoints support idempotency keys to safely retry.

### 4-Eyes Principle
- **Destructive Superadmin Actions**: Account deletion, staff deactivation, and system-wide setting changes require a second superadmin approval.
- **Approval Workflow**: Action stays pending until the second admin approves or rejects.

### Emergency Break-Glass Access
- **Two-Phase Workflow**: Credential-verified request (password + TOTP + ≥10-char reason) creates a `pending` row in `break_glass_sessions`; an admin or superadmin other than the requester must approve before any elevated JWT is minted.
- **Two-Person Rule**: Enforced in both the approve and deny handlers — the requester can never act on their own session.
- **Time-Limited Token**: Approval mints a 30-minute JWT (configurable via `BREAK_GLASS_TTL_MINUTES`) carrying `breakGlass: true` and the session id; only the SHA-256 hash of the token is stored, never the raw token.
- **Audit-Tagging Middleware**: Every request carrying a break-glass JWT is validated against the live session state (rejects expired / revoked / missing sessions) and appends an action descriptor (method, path, timestamp) to `break_glass_sessions.actions_performed` for forensic replay.
- **RLS Still Applies**: Break-glass grants elevated role permissions within a clinic; it does NOT bypass Row-Level Security or cross-tenant isolation.
- **Lazy Expiry**: Middleware flips stale sessions to `expired` automatically so the admin dashboard always reflects ground truth.
- **Security Alert Hook**: Slack webhook (`SLACK_WEBHOOK_SECURITY`) dispatches on request / approve / deny / revoke; dry-run fallback logs structured events in dev.
- **Admin Dashboards**: `GET /auth/break-glass` (recent 200 rows, optional status filter) and `GET /auth/break-glass/active` (approved sessions not yet expired) for the security team.

---

## 12. AI & Clinical Intelligence

### AI Processing Architecture
- **Async Job Queue (BullMQ)**: Redis DB2 queue, 2 concurrent AI jobs, 10 jobs/minute rate limit, 2 retry attempts with exponential backoff.
- **<50 ms Job Submission**: Non-blocking API response with job ID.
- **Result Delivery**: SSE push plus polling fallback.
- **Job Status Tracking**: PENDING → PROCESSING → COMPLETED / FAILED with progress events.

### Twelve Clinical AI Actions
1. **Formulation** — Biopsychosocial 5P formulation generation.
2. **ISBAR** — Clinical handover (Situation, Background, Assessment, Recommendation).
3. **Maudsley** — Maudsley prescribing case summary.
4. **91-Day Review** — Statutory MHA review documentation.
5. **Letter** — GP referral and clinical correspondence drafting.
6. **Ambient Scribe** — Audio → SOAP note post-processing.
7. **Admin Report** — Management report generation.
8. **Report Insight** — Narrative analysis of Report Builder data.
9. **Handover Summary** — Shift handover auto-generation.
10. **Medication Adherence** — MAR adherence analysis and summary.
11. **ECT Summary** — ECT course summary and response tracking.
12. **Discharge Summary** — Comprehensive discharge documentation.

### AI Validation Pipeline
- **Empty/Short Output Detection**: Reject responses shorter than a configurable character threshold.
- **Drug Dose Anomaly Detection**: Flag doses >10× standard ranges for review.
- **Cross-Patient PII Leak Detection**: Detect multiple MRNs or names in a single output.
- **Mandatory Section Completeness**: Verify 5P formulations contain every required section.
- **Markdown Stripping**: Remove formatting artefacts.
- **Output Hashing**: SHA-256 integrity verification.
- **Provenance Recording**: Model, version, input references, and validation results stored per output.

### AI Governance
- **`ai_provenance` Table**: Model name + version, output SHA-256, input data references, validation-layer results, and prompt template version for every generation.
- **Draft-Only Model**: AI output is never signed directly — every output becomes a draft requiring clinician review.
- **Clinician Review Workflow**: Explicit approve/modify/reject with modification summary stored.
- **Prompt Versioning**: Prompt template version tracked for regulatory audit.

### LLM Integration
- **Local Ollama**: On-premise inference — no PHI leaves the environment.
- **Supported Models**: qwen2.5:14b (preferred), llama3.2 (lite edition).
- **Streaming Responses**: Token-streamed generation for real-time feedback.
- **Context Length Management**: Intelligent context window sizing per task.

### Voice Memo & Transcription
- **Audio Capture**: Record consultations from the Drafts page.
- **Faster-Whisper Transcription**: Local transcription of audio.
- **Transcript Editing**: Review and correct before saving.
- **Draft Pipeline**: Transcript becomes a draft clinical note awaiting sign-off.

### Ambient Scribe (Multi-Pass)
- **Three-Pass Pipeline**: Pass 1 full transcription, Pass 2 SOAP structuring, Pass 3 clinical context integration.
- **Automatic SOAP Generation**: Subjective / Objective / Assessment / Plan.
- **ICD-10 Suggestion**: AI-assisted diagnosis coding.
- **MBS Item Coding**: Auto-suggest Medicare Benefits Schedule items for billing.

### Mobile Medical Scribe
- **PWA-Installable Route**: `/m/scribe/:patientId` can be installed as a standalone PWA via the `/manifest.webmanifest` at scope `/m/`, giving clinicians a home-screen launcher that opens straight into scribing without any browser chrome.
- **Consent Gate**: Big record button is disabled until the clinician confirms "patient has consented to being recorded for clinical scribing".
- **One-Tap Record / Stop**: Single 120-px `IconButton` for each state. Visual and screen-reader state announced via `role="status"` live region.
- **Live Transcript Pane**: Streams partial transcripts from the existing Whisper backend in 5-second batches as the consultation proceeds. Scrollable, announced via `role="log"` with `aria-live="polite"` for VoiceOver iOS and TalkBack Android.
- **iOS Safari + Android Chrome**: Uses MediaRecorder with webm/opus fallback chain. Graceful "device not supported" card for older browsers.
- **On-Prem Whisper**: All audio stays inside the clinic network — audio is posted to the same `/api/v1/scribe/stream-chunk` endpoint as the desktop ambient recorder, so there is exactly one scribe pipeline and one audit surface. No second copy of Whisper to maintain.
- **No PHI in URL**: Patient id is an opaque UUID; patient label is passed as an optional query param for display only.

---

## 13. Interoperability & Integration

### FHIR R4
- **Ten Resources Implemented**: Patient, Encounter, Condition, MedicationStatement, AllergyIntolerance, Observation, DiagnosticReport, Practitioner, Organization, CapabilityStatement.
- **FHIR Search**: Parameterised search on all exposed resources.
- **FHIR Create**: POST for observations and assessments.
- **FHIR Bulk Export ($export)**: NDJSON export for data portability.
- **AU Identifier Mapping**: Medicare, IHI, DVA mapped to official FHIR code systems.

### SMART on FHIR
- **Authorisation Flow**: OAuth2 authorisation code grant.
- **Well-Known Configuration**: `.well-known/smart-configuration` endpoint.
- **Context Launch**: Patient and user scopes at launch.
- **Third-Party Apps**: Launch FHIR apps within the EMR context.

### Electronic Prescribing
- **ETP2 (NPDS)**: Electronic Transfer of Prescriptions via National Prescription Delivery Service.
- **ETP1 (eRx Adapter)**: Fallback SOAP adapter for paper-based backup.
- **Script Token Generation**: Barcode tokens for pharmacy redemption.
- **Token Delivery**: SMS and email delivery of prescription tokens.
- **Active Script List (MySL)**: Query patient's national active prescription list.
- **SafeScript / PDMP**: Real-time check for Schedule 8 and monitored medicines.
- **Prescriber Validation**: AHPRA registration verified before prescribing.

### Pathology Integration (HL7 v2 MLLP)
- **Outbound Orders**: ORM^O01 messages to lab systems.
- **Inbound Results**: ORU^R01 result messages from labs.
- **MLLP Transport**: TCP socket with MLLP framing.
- **Async Processing**: BullMQ `hl7Worker` for non-blocking processing.
- **Result Storage**: Results stored with reference ranges and abnormal flags.
- **Clinician Notifications**: SSE real-time alerts on result arrival.
- **Result Download**: View and download the original lab report.

### National Healthcare Services
- **National Health Services Directory (NHSD)**: Provider and service lookup by name, specialty, and location.
- **Healthcare Identifier Service**: IHI lookup via Medicare + name + DOB; HPI-I and HPI-O validation.
- **Medicare Number Validation**: Verify Medicare numbers against NHIS.
- **My Health Record Upload**: MHR-compliant shared health summary and discharge summary upload.

### Government Reporting
- **CMI/NOCC (Victorian)**: Community Mental Health Reporting — episode submission, service contacts, outcome measure submission (HoNOS, K-10, LSP-16) in de-identified form.
- **Automated Data Mapping**: EMR fields mapped to CMI structures with validation.

### Microsoft Office 365
- **Outlook Calendar Sync**: Appointments synced to clinician calendars.
- **Email Integration**: Send correspondence via Office 365.
- **Teams Meetings**: Auto-generated Teams links for telehealth.
- **SharePoint / OneDrive**: Optional document storage integration.
- **OAuth2 Flow**: Secure per-user authorisation.

### Mobile Patient App (Zitavi)
- **Data Sync**: Patient-reported mood, vitals, and journal entries flow into the EMR.
- **EMR Gateway Microservice**: Separate service (port 4002) bridges Zitavi MongoDB to the EMR.
- **Two-Way Sync**: Medication reminders and care plans flow outward to Zitavi.
- **Read-Only MAR View**: Consented family/carers can view the MAR via Zitavi.

### Error Monitoring
- **Sentry Integration**: Automatic error reporting.
- **PHI Scrubbing**: Medicare, IHI, DVA, phone, email, DOB, and name fields redacted before transmission.
- **Real-Time Alerts**: Production error alerts with severity.

### Webhooks
- **Outbound Webhooks**: Deliver domain events to subscribed external systems.
- **Signed Delivery**: HMAC-signed payloads for authenticity.
- **Retry & Dead-Letter**: Automatic retries with dead-letter handling.

---

## 14. Compliance & Regulatory

### Privacy & Data Protection
- **Australian Privacy Principles (APP 1–13)**: Full compliance across notice, collection, use, disclosure, quality, security, access, correction, and complaints handling.
- **Data Portability**: Export a complete patient record as structured JSON.
- **Anonymisation**: Automated PII removal preserving clinical structure for research use.
- **Consent Tracking**: Separate consent records for treatment, research, and data sharing.
- **Data Breach Register**: `data_breach_log` with severity, reporter, affected records, and resolution.
- **Notifiable Data Breaches (NDB)**: OAIC breach notification workflow support.

### Mental Health Compliance
- **Multi-Jurisdiction MHA Support**: State-specific rules for Victoria, NSW, Queensland, SA, WA, Tasmania, ACT, NT.
- **Involuntary Patient Flagging**: Automatic restriction of voluntary features for involuntary patients.
- **CTO-Specific Workflows**: Community Treatment Order management and reviews.
- **Consent Override Documentation**: Legal basis for treating without consent recorded on the patient record.
- **Second Opinion Tracking**: Documented second opinion for involuntary treatment where required.

### Clinical Risk Management (ISO 14971)
- **Risk Triggers**: Automatic flagging of high-risk patients.
- **Escalation Pathways**: Automatic escalation to duty manager or senior clinician.
- **Incident Tracking**: Document clinical incidents and outcomes (feature support; organisations configure severity definitions).
- **Mitigation Documentation**: Safety plans, observations, and interventions linked to risk.
- **Quality Improvement**: Pattern analysis across incidents for system learning.

### Software as a Medical Device
- **IEC 62304 Traceability**: Requirements → Design → Code → Test matrix maintained in the repository.
- **SaMD Class B**: Clinical decision support with clinician override.
- **Software Bill of Materials**: CycloneDX SBOM generated in CI.
- **Risk Management**: ISO 14971-compliant risk register and mitigation.

### Information Security (ISO 27001)
- **ISMS**: Formal information security management system with policy set.
- **Data Classification**: PHI, PII, Confidential, Internal, Public.
- **Cryptography Standards**: NIST SP 800-52 (TLS), NIST SP 800-38D (AES-GCM), OWASP bcrypt.
- **Key Management**: Environment variables in development; AWS KMS or HashiCorp Vault in production.
- **Incident Management**: Severity classification, response team, 30-day notification timeline.
- **Supplier Management**: SOC 2 / ISO 27001 verification and data processing agreements.
- **Audit Schedule**: Quarterly internal and annual external penetration testing.
- **Policy Versioning**: Traceability matrix with version control for all policies.

### Accessibility (WCAG 2.1 AA)
- **Keyboard Navigation**: Full keyboard access to every feature.
- **Focus Management**: Clear focus indicators and logical tab order.
- **Colour Contrast**: WCAG AA compliant palette.
- **Screen Reader Support**: Semantic HTML and ARIA labels.
- **Responsive Layout**: Tablet and desktop layouts.

---

## 15. Deployment & Operations

### Single-Clinic Deployment (macOS)
- **Standalone .app**: Self-contained macOS application.
- **First-Run Setup**: Automatic installation of PostgreSQL, Redis, Node, Ollama, and Whisper.
- **Health Checks**: Dependency verification on every launch.
- **Database Auto-Creation**: `signacaredb` database provisioned on first run.
- **License Binding**: Machine ID-based license HMAC signing.
- **Auto-Update**: Background update checks with notification.

### Production Multi-Server Deployment
- **API Cluster**: PM2 with 4+ workers and load balancing.
- **Database**: PostgreSQL 16 with PgBouncer connection pooling (600 `max_client_conn`).
- **Cache & Queue Layer**: Redis 7 with Sentinel for HA (3-node cluster).
- **Worker Fleet**: Separate BullMQ workers for AI, HL7, reports, and webhooks.
- **Reverse Proxy**: Nginx for SSL termination and static serving.
- **GPU Servers**: Separate Ollama and Whisper GPU instances.
- **Idempotency Middleware**: Clinical writes protected against duplicate submission.

### Database Management
- **Automated Backups**: Daily `pg_dump` with 30-day retention.
- **Persistent Backup Configuration**: Clinic-configurable backup schedule and destination, with history and restore drill.
- **Backup Verification**: Weekly test restore to verify integrity.
- **WAL Archiving**: Point-in-time recovery support.
- **Materialised View Refresh**: Nightly `mv_daily_metrics`, hourly `mv_staff_caseload`.
- **Audit Log Archival**: Monthly archival via `archive_old_audit_logs(months)`.
- **Index Maintenance**: Regular unused-index identification.

### Health Monitoring
- **Liveness Probe**: `GET /health` for load balancer checks.
- **Readiness Probe**: `GET /ready` validates PostgreSQL and Redis connectivity.
- **Uptime Monitoring**: Integration-ready for Uptime Robot, Pingdom, Better Stack.
- **Error Tracking**: Sentry with PHI scrubbing.
- **Structured Logging**: Pino JSON logging to stdout, compatible with ELK / CloudWatch.

### Graceful Shutdown
- **Connection Draining**: 30-second drain period for in-flight requests.
- **Process Cleanup**: HTTP close, DB pool destroy, Redis quit.
- **PM2 Configuration**: `kill_timeout: 35s` for controlled shutdown.
- **Data Safety**: All pending transactions finish before process exit.

### Disaster Recovery
- **RPO**: 24 hours (daily backups).
- **RTO**: ~30 minutes local restore, ~4 hours production failover.
- **Recovery Scenarios**: Database corruption, application failure, machine loss, security recovery — each with a runbook.
- **Testing Cadence**: Monthly backup restore tests, quarterly failover tests, annual full DR simulation.

### Blob Storage Facade
- **Unified Upload Pipeline**: Single `BlobStorage` facade for all patient-attached uploads (pathology, documents, physical health, alerts, ECT, legal).
- **Pluggable Backends**: Local disk, S3, or Azure Blob storage configurable per deployment.

---

## 16. Configuration & Customisation

### Clinic-Level Settings
- **Branding**: Configurable sidebar title, subtitle, logo, and colour per clinic.
- **Tab Visibility**: `clinic_tab_config` table controls which clinical tabs appear (e.g. hide ECT for community-only clinics, hide Legal for non-MHA services).
- **UI Theme**: Light/dark mode.
- **Clinic Profile**: Address, phone, website, ABN, contact details.
- **Feature Flags**: Database-driven feature toggling per clinic.

### Lookup Lists (Power Settings)
Twelve fully customisable list types:
- Professional Disciplines
- Clinical Roles
- Role Types
- Referral Sources
- Investigation Types
- Alert Types
- Legal Order Types
- Appointment Modes
- Template Categories
- Episode Types
- Referral Outcome Reasons
- Shift Types

### Role-Based Feature Access
- **Module Access Control**: Grant or revoke access to individual clinical modules per staff member.
- **Permission Granularity**: 48 distinct permissions mapped to 6 system roles.
- **Custom Role Policies**: `role_access_policies` for custom restrictions.
- **Temporary Delegation**: Delegate specific permissions for a time-boxed period.

### Template Management
- **Clinical Note Templates**: Reusable templates per note type with mandatory sections.
- **Assessment Templates**: Custom assessment forms with auto-scoring and occasion tracking.
- **Correspondence Templates**: Letter templates with merge fields.
- **Section Rules**: Mandatory vs optional section control.
- **Template Categories**: Organise templates by clinic-specific groupings.

### Organisation Structure
- **Hierarchical Teams**: Nested organisational units (departments, wards, teams).
- **Team Membership**: Staff assignments with roles and dates.
- **Programs**: Clinical programs (e.g. Psychosis, Mood Disorder) assigned to teams.
- **Level Labels**: Customisable organisational level names per clinic.

---

## 17. Staffing & Team Management

### Staff Directory
- **Staff Profiles**: Name, email, phone, discipline, professional qualifications.
- **AHPRA Registration**: Registration number, specialty, and expiry.
- **Prescriber Details**: Prescriber number and schedule authorisations.
- **Provider Numbers**: Medicare, DVA, and state-specific provider identifiers per location.
- **Credentials**: Licences and certifications on file.

### Team Assignments
- **Multiple Team Membership**: A staff member can belong to multiple teams simultaneously.
- **Role Per Team**: Different role in different teams (Primary, Delegated, Acting, Secondment).
- **Date Tracking**: Start/end dates with historical record.
- **Status Indicators**: Active / inactive with reason.

### Staff Leave
- **Leave Calendar**: Annual, Sick, Long Service, Unpaid, Parental, Compassionate types.
- **Leave Status**: Pending, Approved, Cancelled, Completed.
- **Balance Calculation**: Remaining leave by type.
- **Coverage Planning**: Identify clinicians on leave for workload distribution.

### Staff Access
- **Six System Roles**: Superadmin, Admin, Manager, Clinician, Receptionist, Readonly.
- **Module Activation**: Turn clinical modules on or off per clinic and per staff member.

---

## 18. Communication & Messaging

### Internal Messaging
- **Threaded Discussions**: Clinic-wide threaded message threads.
- **Participants**: Add or remove staff from threads.
- **Real-Time Notifications**: SSE-delivered notifications on new messages.
- **Read Tracking**: Per-recipient read status.
- **Archiving**: Archive inactive threads.

### Task Management
- **Task Creation**: From phone triage, messages, or manual entry.
- **Assignment**: To specific staff members or teams.
- **Priority**: Urgent, High, Medium, Low.
- **Status**: Open, In Progress, Completed, Overdue.
- **Reminders**: Assignment and overdue notifications.
- **Personal Task Dashboard**: Filtered by priority and status.

### Phone Triage Tasks
- **Auto-Task Creation**: "Message Taken" outcomes auto-create a task.
- **Pre-Populated Content**: Caller details, reason, triage notes carried into the task.
- **Immediate Visibility**: Task appears in the assignee's queue without delay.
- **Callback Link**: Task links back to the originating call record.

### Push Notifications (SSE)
- **Real-Time Events**: Patient arrival, task assignment, AI job completion, pathology result, escalation.
- **Notification Preferences**: Per-user notification configuration.
- **Notification History**: Past notifications retrievable.

---

## 19. Advanced Clinical Features

### Escalation Management
- **Escalation Pathways**: Automatic escalation of high-risk patients to duty manager.
- **Configurable Triggers**: NEWS2 score, suicide risk, missing assessment, overdue monitoring.
- **Escalation Queue**: Central tracking with status and age.
- **SSE Push**: Real-time notification to manager dashboard.
- **Resolution Tracking**: Status and time-to-resolution captured.

### Clinical Decision Support
- **Drug Interaction Checking**: Real-time at prescribing time.
- **Allergy Alerts**: Modal confirmation for known conflicts.
- **Duplicate Therapy Detection**: Warn on duplicate classes.
- **Dose Checking**: Flag unusual doses.
- **Pathway Protocols**: Embedded clinical protocols per pathway.

### Group Therapy
- **Group Sessions**: Schedule and manage group therapy.
- **Attendance**: Who attended, who was absent.
- **Group Notes**: Therapist-generated group session notes.
- **Group Outcomes**: Outcome measures assigned to participants.
- **Historical Archive**: Full group session history.

### ECT Module (Six Sub-Tabs)
- **Course Management**: Create and select courses with indication, electrode placement, anaesthetic protocol.
- **Treatment Log**: Pre-procedure, stimulus, anaesthesia, seizure response, recovery.
- **Prescription**: Prescriber-only ECT prescription with charge strategy.
- **Consent & MHA**: Voluntary / involuntary / CTO / guardian / emergency consent plus tribunal details.
- **Assessments**: Cognitive (MMSE, MoCA), pre/post nursing, pre/post medical.
- **Documents**: Eleven document types (consent forms, MHA orders, ECG, CT brain, pathology).

### Referral Management
- **Create Referral**: From the patient record.
- **Referral Types**: Internal, external, urgent, routine.
- **Status**: Pending, Accepted, Declined, Completed.
- **Workflow Events**: Transitions tracked with staff and timestamps.
- **E-Referral**: Electronic transmission to external services.
- **Closure Tracking**: Outcome reasons from configurable lookup list.

### Lived Experience / Peer Support
- **Patient Perspective**: Record patient feedback and lived-experience narrative.
- **Peer Support Involvement**: Document peer worker engagement.
- **Patient-Identified Goals**: Capture patient priorities alongside clinical goals.
- **Engagement Scoring**: Therapeutic engagement and satisfaction tracking.

### Tracking & Monitoring
- **Symptom Tracking**: Longitudinal tracking of specific symptoms.
- **Monitoring Schedules**: Create monitoring plans with follow-up intervals.
- **Compliance**: Track adherence to monitoring plans.
- **Outcome Recording**: Results of monitoring appointments.
- **Alert Thresholds**: Automatic alerting when metrics worsen.

### Hotspots
- **Clinical Hotspots**: Mark specific patients or cohorts for heightened attention with reason and review date.
- **Dashboard Surfacing**: Hotspots appear prominently on team and manager dashboards.

---

## 20. System Features & Infrastructure

### Search & Discovery
- **PostgreSQL Full-Text Search**: `tsvector` with GIN index, weighted A=name, B=MRN, C=Medicare, D=phone, via `plainto_tsquery`.
- **Fuzzy Matching (pg_trgm)**: Trigram GIN indexes on `given_name` and `family_name` for typo-tolerant search.
- **Automatic Index Updates**: Database triggers keep search vectors current.
- **Quick Search**: Unified search bar for patients, staff, and resources.

### Real-Time Events (Server-Sent Events)
- **Persistent Per-User Connection**: `GET /api/v1/events/stream`.
- **Redis PubSub Channels**:
  - `ai-events:{clinicId}` — AI job progress and completion
  - `clinic-events:{clinicId}` — patient arrival, escalations
  - `user-events:{userId}` — task assignment, messages
- **Event Types**: patient-arrived, task-assigned, medication-due, pathology-result, escalation, ai-job-complete.
- **Auto-Reconnect**: Exponential backoff from 1 s to 30 s.
- **Heartbeat**: 30-second keepalive to defeat proxy idle timeouts.
- **Cache Invalidation**: Auto-invalidate React Query caches on relevant events.

### Performance Optimisation
- **Code Splitting**: Every route lazy-loaded via `React.lazy()`.
- **Caching Strategy**: React Query stale-while-revalidate with query key factories.
- **Database Query Optimisation**: Composite and partial indexes for soft-delete filters.
- **Compression**: Gzip responses (~70% bandwidth reduction).
- **Connection Pooling**: Knex (min 5, max 50) plus PgBouncer for 600+ concurrent connections.
- **Materialised Views**: Pre-computed reporting data with scheduled refresh.
- **Pagination**: Limit/offset pagination on large result sets.

### API & Developer Experience
- **Swagger / OpenAPI**: Auto-generated documentation at `/api/docs`.
- **Interactive Testing**: Try-it-out in Swagger UI.
- **Schema Validation**: Zod schemas for every request and response.
- **Standard Error Codes**: Consistent error envelope with explanation.

### Observability
- **Request Metrics**: Middleware collects latency, status, and endpoint metrics.
- **Structured Logging**: JSON logs with request IDs for correlation.
- **Database Metrics**: Connection pool stats and query performance.
- **Health Endpoints**: `/health` liveness and `/ready` readiness probes.

### Environment Management
- **Zod-Validated Config**: Environment variables validated at boot.
- **Deployment Modes**: Development, staging, production with environment-specific settings.
- **Secrets Management**: Environment variables in development; KMS/Vault in production.

---

## 21. Feature Module Index

This index maps every feature area to its implementation modules so readers can cross-reference the narrative above to code.

### Frontend Modules (`apps/web/src/features/`)

| Module | Purpose |
| --- | --- |
| `ai-agent` | Clinical AI integration UI and job tracking |
| `appointments` | Scheduling, calendar, check-in |
| `audit` | Audit timeline and forensic replay |
| `auth` | Login, MFA, session management |
| `beds` | Bed management and bed board |
| `billing` | Invoicing, payments, MBS coding |
| `case-management` | Caseload, care plans, community resources |
| `clinical-notes` | Note creation, templates, signing |
| `clinical-review` | Clinical oversight and quality |
| `clozapine` | Clozapine registry and blood monitoring |
| `correspondence` | GP letters, referrals, discharge summaries |
| `dashboard` | Role-specific dashboards |
| `drafts` | Personal draft queue (notes, voice memos, scribe) |
| `episodes` | Episode of care management |
| `ereferral` | Electronic referral lifecycle |
| `escalations` | Escalation tracking |
| `exports` | Patient data export and portability |
| `flags` | Patient flags and alerts |
| `group-therapy` | Group session management |
| `handover` | Shift handover with AI summary |
| `intake` | Structured intake for new referrals |
| `integrations` | Integration configuration UI |
| `lai` | Long-acting injectable tracking |
| `lists` | Power-settings lookup lists |
| `llm` | LLM prompt and provenance UI |
| `manager` | Manager-focused views |
| `medications` | Prescribing and MAR |
| `messages` | Legacy messaging surface |
| `messaging` | Threaded internal messaging |
| `mh-act` | Mental Health Act, legal orders, consent |
| `nursing` | Nursing observations, NEWS2, falls, fluid balance, wound care |
| `org-settings` | Organisational structure and programs |
| `pathology` | Pathology ordering and result review |
| `patients` | Patient CRUD and detail tabs |
| `power-settings` | Clinic-wide lookup configuration |
| `psychiatrist` | Psychiatrist-specific views |
| `receptionist` | Check-in, phone triage, SMS, waitlist |
| `referrals` | Referral lifecycle |
| `reports` | Admin reports and Report Builder |
| `risk` | Risk assessment and safety planning |
| `risk-allergies` | Allergy and adverse reaction tracking |
| `settings` | General settings |
| `staff-settings` | Staff directory, teams, roles |
| `subscription` | Licensing and subscription management |
| `tasks` | Task queue and assignment |
| `templates` | Note and correspondence templates |
| `treatment-pathways` | Pathway selection and progression |
| `voice` | Voice memo capture and transcription |
| `waitlist` | Waitlist management |

### Backend Modules (`apps/api/src/features/`)

| Module | Purpose |
| --- | --- |
| `advance-directives` | Advance care planning documents |
| `allergies` | Allergy and adverse reaction records |
| `appointments` | Scheduling, calendar, check-in |
| `audit` | Audit log, timeline, activity logging |
| `auth` | Login, JWT, TOTP MFA, WebAuthn |
| `backup` | Persistent backup config, history, restore |
| `beds` | Bed register and movements |
| `billing` | Invoicing, payments, MBS integration |
| `carers` | Carer and family contact records |
| `checklists` | Configurable clinical checklists |
| `clinic` | Clinic profile and configuration |
| `clinical-decision` | Drug interaction, allergy, dose, duplicate checks |
| `clinical-notes` | Note CRUD, signing, templates |
| `clinical-review` | Clinical review workflow |
| `clozapine` | Clozapine registry and monitoring |
| `contacts` | Contact records and service delivery |
| `correspondence` | Outbound letters, recipient tracking |
| `dashboard` | Role-based dashboard aggregation |
| `documents` | Document upload and metadata |
| `episode` | Episode lifecycle, team allocation |
| `ereferral` | Electronic referral transmission |
| `escalations` | Escalation queue and resolution |
| `events` | SSE and Redis PubSub event delivery |
| `feature-flags` | Clinic-level feature toggling |
| `flags` | Patient flags and alerts |
| `group-therapy` | Group session scheduling and attendance |
| `lai` | LAI schedule and administration |
| `license` | License validation and machine binding |
| `llm` | Clinical AI actions, provenance, validation |
| `medications` | Prescriptions, MAR, administrations |
| `messaging` | Threaded messaging |
| `mha` | Legal orders, consent, tribunal |
| `org-settings` | Organisational hierarchy |
| `outcomes` | Outcome measure forms and scoring |
| `pathology` | HL7 ORM/ORU, results, clinician alerts |
| `patient-app` | Zitavi mobile app gateway |
| `patients` | Patient CRUD, search, contacts |
| `power-settings` | Lookup lists |
| `prescriptions` | E-script, SafeScript, ActiveScript integration |
| `privacy` | Export, anonymisation, breach logging |
| `referrals` | Referral lifecycle and e-referral |
| `reports` | Dashboard, Report Builder, metrics |
| `risk` | Risk assessment |
| `roles` | RBAC role management |
| `safety-plan` | Safety planning |
| `settings` | General settings endpoints |
| `staff` | Staff directory, AHPRA, prescriber numbers |
| `staff-settings` | Team assignments, leave |
| `tasks` | Task creation and assignment |
| `templates` | Note, assessment, and correspondence templates |
| `treatment-pathways` | Pathway selection and milestones |
| `voice` | Whisper transcription pipeline |
| `webhooks` | Outbound webhook delivery |
| `workflows` | Clinical workflow engine |

---

## Appendix A — Feature Highlights Suitable for Demos

- **Ambient Scribe**: Record a consultation, receive a structured SOAP note with ICD-10 and MBS suggestions awaiting clinician sign-off.
- **5P Formulation in One Click**: Generate a complete biopsychosocial formulation from the patient's history using local LLM inference.
- **Bed Board with Live NEWS2**: Visual ward view with colour-coded acuity driven by the latest observations.
- **Report Builder**: Combine 20+ metrics across 7 dimensions and 5 visualisations, with AI narrative explanation of the trends.
- **Two-Way Mobile App Sync**: Patient-reported mood, medication, and journal entries flowing into the clinical record via the Zitavi gateway.
- **One-Hour Setup**: Single-clinic macOS deployment installs PostgreSQL, Redis, Node, Ollama, and Whisper on first launch.
- **Complete Audit Trail**: 329 triggers on 95+ tables produce a tamper-evident hash chain suitable for forensic reconstruction.
- **RLS-Enforced Multi-Tenancy**: Database-enforced tenant isolation via 104 PostgreSQL RLS policies — defence in depth beyond application filtering.

---

## Appendix B — Technology Stack Summary

- **Frontend**: React, Vite, React Query, TypeScript, lazy-loaded routes.
- **Backend**: Node.js, Express, Knex, Zod, BullMQ, Pino.
- **Database**: PostgreSQL 16 with pgcrypto, pg_trgm, RLS, materialised views, PgBouncer.
- **Cache & Queues**: Redis 7 with Sentinel HA.
- **AI Inference**: Local Ollama (qwen2.5:14b / llama3.2), Faster-Whisper.
- **Integration**: FHIR R4, SMART on FHIR, HL7 v2 MLLP, NPDS / eRx, SafeScript, NHSD, HI Service, Office 365.
- **Deployment**: PM2, Nginx, macOS standalone DMG, Linux server cluster.
- **Observability**: Sentry, Swagger/OpenAPI, Pino JSON, liveness/readiness probes.

---

*End of document. This file is the authoritative, export-ready features reference for Signacare EMR.*

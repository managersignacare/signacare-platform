# Signacare EMR - User Manual

## Getting Started

### Login
1. Open your browser to the Signacare URL
2. Enter your email and password
3. If MFA is enabled, enter the 6-digit code from your authenticator app
4. You will be directed to the Dashboard

### Navigation
- **Sidebar** (left): Main navigation organised into sections
  - Top: Dashboard, Patients, Appointments, AI Assistant, Drafts
  - Clinical Lists: LAI, MH Act, Clozapine, 91-Day Review, Hot Spots, Referral List, Shift Handover
  - Teams: Intake, ACIS, PARC, CCU, IPU, Outpatients, Group Therapy
  - Admin: Tasks, Reception, Resources, Templates, Reports, Audit, Billing, Exports, Bed Board
  - Settings: Settings, Org Settings, Staff Assignments
  - Platform (superadmin only): Power Settings, Subscription

### Session
- Session expires after 60 minutes of inactivity (15 minutes without interaction)
- A warning dialog appears 2 minutes before expiry
- During active AI Scribe recording or processing, the app keeps the session alive automatically so long interviews are not interrupted by idle logout
- Click "Extend Session" to reset the timer

---

## Role-Based Workflows

### Receptionist

#### Daily Check-In Workflow
1. Go to **Admin > Reception**
2. Click **Check-in** tab
3. View today's appointments with filter chips (All/Waiting/Arrived)
4. Click **Check In** next to each patient as they arrive
5. The clinician receives an automatic arrival notification on their dashboard

#### Phone Triage
1. Go to **Reception > Phone Triage** tab
2. Fill in caller details (name, phone, relationship)
3. **Search for patient** by typing name or MRN in the patient search box
4. Select urgency (Urgent/Semi-Urgent/Routine)
5. Enter reason for call and triage notes
6. **Assign to staff** — select the clinician from the dropdown
7. Select **Outcome**:
   - "Message Taken" → auto-creates a task in the assigned staff's task list
   - Other outcomes record the call without task creation
8. If a patient is linked, the call details are saved as a note in the patient's episode

#### SMS Appointment Reminders
1. Go to **Reception > SMS Reminders** tab
2. Review tomorrow's appointments
3. Check the count of patients with phone numbers
4. Click **Send Reminders** to send bulk SMS

#### Waitlist
1. Go to **Reception > Waitlist** tab
2. View patients with position number, estimated wait time, and priority
3. Wait times are auto-calculated based on average appointment duration

---

### Clinician (Psychiatrist / MH Nurse / Case Manager)

#### Starting the Day
1. The **Dashboard** shows your personalised view based on your role
2. Switch between role views using the **role chips** at the top (Clinician/Nursing/Case Mgmt/Manager)
3. KPI cards show appointments, open tasks, referrals, messages, caseload
4. Sparklines show 7-day trends; arrows show change from previous period

#### Viewing a Patient
1. Go to **Patients** in the sidebar
2. Search by name or MRN
3. Click a patient row to open their detail page
4. Navigate between **19 tabs** across the top:
   Summary, Overview, Episodes, Alerts & Plans, Medications, Pathology, Physical Health, Legal, Referrals, Documents, Correspondence, Assessments, 91-Day Review, Pathways, Lived Experience, Tracking, Inpatient Care, ECT, Appointments

#### Writing a Clinical Note
1. Open a patient
2. Click the **+ Note** button (top right of Summary tab)
3. Select note type (Progress, Ward Round, Intake, Phone, etc.)
4. Write content or use AI to generate from template
5. Click **Save** (saves as draft) or **Sign** (finalises)
6. Unsigned drafts appear in the **Drafts** page

#### Prescribing Medication
**Requires**: Prescriber number in your staff profile
1. Open patient > **Medications** tab
2. Click **Prescribe** button (only visible if you have a prescriber number)
3. Search for medication
4. Enter dose, frequency, route
5. Click **Prescribe & Save**

#### MAR Chart (Medication Administration)
1. Open patient > **Medications > MAR Chart** subtab
2. View today's medications auto-populated from prescriptions
3. Time slots are intelligently assigned based on frequency (BD→08:00/20:00, TDS→08:00/14:00/22:00)
4. Click a scheduled time dot to record administration:
   - Status: Given / Refused / Withheld
   - Context: Supervised / Self Administered / Inpatient / Community
   - Enter actual administration time
5. Switch to **Longitudinal** view to see administration history (7/14/30/90 days)
6. Click **AI Summary** for adherence analysis

#### Care Plan Goals
1. Open patient > **Alerts & Plans > Goals** tab
2. Click **Add Goal**
3. Enter goal text, type (Personal/Clinical/Social/Vocational/Housing), target date
4. Track progress by clicking status chips: Active → In Progress → Achieved
5. View **Recovery Star** tab for visual outcome tracking across 10 domains

#### Clinical Formulation (5P Model)
1. Open patient > **Summary** tab
2. Scroll to **Clinical Formulation** section
3. Click **Generate with AI** for auto-generated biopsychosocial formulation
4. Edit the text and save
5. Structured 5P formulations are also available in the formulations list

---

### Mental Health Nurse

#### Inpatient Observations
1. Open patient > **Inpatient Care** tab
2. Select **Observations** subtab
3. Select observation level (General/15min/30min/Hourly/Constant)
4. Enter location, mood, behaviour, sleep, risk concerns
5. Click **Save Observation**

#### NEWS2 Assessment
1. Open patient > **Inpatient Care > NEWS2** tab
2. Adjust sliders for respiratory rate, SpO2, BP, pulse, temperature
3. Select consciousness level (Alert/Voice/Pain/Unresponsive)
4. Score auto-calculates with colour coding:
   - 0 (green): No escalation
   - 1-4 (teal): Low risk
   - 5-6 (orange): Medium risk — increase monitoring
   - 7+ (red): High risk — urgent clinical review
5. Click **Save Assessment**

#### Falls Risk Assessment
1. Open patient > **Inpatient Care > Falls Risk** tab
2. Check applicable risk factors (9 items)
3. Score auto-calculates: Low (<3), Medium (3-5), High (6+)
4. Click **Save Assessment**

#### Fluid Balance
1. Open patient > **Inpatient Care > Fluid Balance** tab
2. Enter intake (oral, IV, other) and output (urine, vomit, drain, other) in mL
3. Net balance auto-calculates with colour coding
4. Click **Record Entry**

#### Wound Care
1. Open patient > **Inpatient Care > Wound Care** tab
2. Enter wound site, type, size, depth, exudate, odour, surrounding skin, dressing
3. Click **Save Wound Assessment**
4. View wound history below

#### Shift Handover
1. Go to **Clinical Lists > Shift Handover** in the sidebar
2. Select shift type (Morning/Afternoon/Night)
3. **Write Handover** tab: Write notes for each patient in your caseload
4. Click **AI Summary** for auto-generated shift summary
5. Click **Save Handover** — notes are saved to each patient's record
6. **Incoming Handover** tab: View notes from previous shift, filtered to your patients only

---

### Case Manager

#### Caseload View
1. The **Dashboard** (Case Mgmt view) shows your caseload with RAG status
2. The **Patients** page defaults to showing only your assigned patients
3. Red = overdue contact, Amber = at risk, Green = on track

#### Community Resources
1. Go to **Admin > Resources** in the sidebar
2. Search the community resource directory
3. View contact details, referral processes, eligibility criteria

---

### Clinic Manager

#### Dashboard KPIs
1. Switch to **Manager** view on the Dashboard
2. View Contacts KPI, Staff Caseload, DNA Rates, Workload Alerts, Service Statistics, Billing
3. Data is broken down by clinician with colour-coded progress bars

#### Report Builder
1. Go to **Admin > Admin Reports > Report Builder** tab
2. **Select metrics** from 20 available (click chips to toggle)
3. **Choose dimension**: By Clinician, By Team, By Day, etc.
4. **Set date range** or use quick presets (7d/30d/90d/6mo/1yr)
5. **Select visualisation**: Bar Chart, Donut, Trend Line, Heatmap, or Table
6. Click **Generate Report**
7. View results with:
   - Summary KPI cards
   - Interactive charts
   - Automatic trend detection
   - Data table
8. **Export CSV** or **Print/PDF**
9. Click **AI Insights** for AI-generated analysis

#### Scheduled Reports
1. Go to **Admin Reports > Scheduled** tab
2. Click **+ New Schedule**
3. Select report type, frequency (weekly/monthly), format (PDF/CSV/Excel)
4. Enter email recipients
5. Click **Create Schedule**

---

### ECT Workflow

#### Creating an ECT Course
1. Open patient > **ECT** tab
2. Click **New ECT Course** in the Courses sub-tab
3. Fill in:
   - Indication (e.g., Treatment-resistant depression)
   - Electrode placement, pulse width
   - Anaesthetic protocol (agent, muscle relaxant, anticholinergic)
   - Treating psychiatrist and anaesthetist
4. Click **Create Course**

#### Recording Treatment
1. Select the ECT course from the dropdown
2. Go to **Treatment Log** sub-tab
3. Click **Record Treatment**
4. Complete all sections:
   - Pre-procedure: vitals, fasting, consent check
   - Stimulus: placement, charge, frequency, pulse width
   - Anaesthesia: agent + dose, relaxant + dose
   - Seizure: motor duration, EEG duration, adequacy
   - Recovery: post-vitals, side effects, time to orientation
5. Click **Save Treatment**

#### ECT Prescription (Prescribers Only)
1. Go to **Prescription** sub-tab
2. Requires prescriber number in your staff profile
3. Enter treating psychiatrist, indication, setting (inpatient/community)
4. Specify electrode placement, charge strategy, medication instructions
5. Click **Save Prescription**

#### Consent & MHA
1. Go to **Consent & MHA** sub-tab
2. Select consent type (Informed/MHA Involuntary/MHA CTO/Guardian/Emergency)
3. For involuntary patients: enter MHA order number, authorising psychiatrist, tribunal date, second opinion
4. Record capacity assessment, risks/alternatives discussed
5. Click **Save Consent Record**

#### ECT Assessments
1. Go to **Assessments** sub-tab
2. Five assessment types available:
   - **Cognitive**: MMSE, MoCA, reorientation time, amnesia
   - **Pre-ECT Nursing**: Vitals, fasting, consent, IV access, medications
   - **Post-ECT Nursing**: Post-vitals, confusion, headache, discharge readiness
   - **Pre-ECT Medical**: Clinical presentation, MSE, risk assessment, rating scales
   - **Post-ECT Medical**: Treatment response, side effects, plan changes
3. Click **Save** for each assessment

#### ECT Documents
1. Go to **Documents** sub-tab
2. Select document type (Consent Form, MHA Order, ECG, etc.)
3. Click **Choose File** to upload
4. View uploaded documents with download links

---

## Staff Management

### Adding a New Staff Member
1. Go to **Settings > Staff Assignments**
2. Click **Add Staff**
3. Fill in personal details, discipline, system role
4. Add AHPRA registration, prescriber details (if applicable)
5. Add provider numbers (Medicare/DVA per location)
6. Click **Onboard Staff**

### Managing Teams & Roles
1. Click **Manage** on any staff row in the directory
2. **Team Memberships**: Add/edit/end team assignments with dates
3. **Role Assignments**: Add roles per team with type (Primary/Additional/Delegated/Acting/Secondment) and category (Clinical/Administrative/Supervisory)
4. Role type options are managed in **Power Settings > Role Types**

### Power Settings (Superadmin)
- **Branding**: Sidebar title, subtitle, logo
- **Professional Disciplines**: Manage discipline types
- **Clinical Roles**: Manage assignable clinical roles
- **Role Types**: Manage assignment types (Primary, Delegated, etc.)
- **System Roles**: Reference for 6 fixed system roles
- **Referral Sources, Investigation Types, Alert Types, Legal Order Types, Appointment Modes, Template Categories, Episode Types**: All configurable lookup lists

---

## Physical Health Monitoring

### Recording Vital Signs
1. Open patient > **Physical Health** tab
2. Scroll to **Physical Health Tracking** section
3. Enter: Weight (kg), Height (cm), BP, Heart Rate, Waist, Blood Glucose
4. BMI auto-calculates with colour coding (green <25, orange 25-30, red >30)
5. Click **Save**
6. View longitudinal tracking table below

---

## Voice Memo
1. Go to **Drafts** page
2. Click **Start Recording** in the Voice Memo section
3. Speak your clinical note
4. Click **Stop** — audio is sent to Whisper for transcription
5. Review and edit the transcript
6. Click **Save as Draft** — appears in your drafts list

---

## Keyboard Shortcuts
| Action | Shortcut |
|--------|----------|
| Search patients | Click search bar in Patients page |
| Quick note | + Note button on patient header |
| Navigate tabs | Click tab labels or scroll horizontally |
| Hard refresh | Cmd + Shift + R |

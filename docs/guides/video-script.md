# Signacare EMR - Role-Based Video Scripts

> Use these scripts to record screen-capture walkthrough videos for each role.
> Recommended tools: Loom, OBS Studio, or QuickTime Screen Recording.
> Each video should be 5-8 minutes. Use the demo login credentials.

---

## Video 1: Receptionist Workflow (6 min)

### Title: "Signacare EMR — Receptionist Daily Workflow"

**[0:00 - 0:30] Intro**
- NARRATION: "Welcome to Signacare EMR. In this video, we'll walk through the daily workflow for a receptionist — from patient check-in to phone triage and appointment reminders."
- SCREEN: Show login page → login as receptionist
- SCREEN: Dashboard loads with Reception view chips visible

**[0:30 - 1:30] Patient Check-In**
- NARRATION: "Let's start with the morning check-in workflow."
- SCREEN: Sidebar → Admin → Reception
- SCREEN: Click "Check-in" tab
- SCREEN: Show the filter chips (All / Waiting / Arrived)
- SCREEN: Click "Waiting" to filter
- NARRATION: "As patients arrive, click the Check In button. This marks them as arrived and sends an automatic notification to their clinician's dashboard."
- SCREEN: Click "Check In" on a patient → show the green "Arrived" chip appear
- NARRATION: "The clinician now sees a notification that their patient has arrived."

**[1:30 - 2:30] Today's Schedule**
- SCREEN: Click "Today's Schedule" tab
- NARRATION: "The schedule view groups today's appointments by clinician, showing time, patient name, appointment type, and status."
- SCREEN: Scroll through clinician groups
- NARRATION: "You can see at a glance who's running on time and who has gaps."

**[2:30 - 4:00] Phone Triage**
- SCREEN: Click "Phone Triage" tab
- NARRATION: "When a call comes in, fill in the caller details."
- SCREEN: Type caller name, phone number
- NARRATION: "Search for the patient by typing their name or MRN. The system searches in real-time."
- SCREEN: Type in patient search → select from dropdown
- SCREEN: Select urgency (Urgent / Semi-Urgent / Routine)
- SCREEN: Enter reason for call, triage notes
- NARRATION: "Assign the call to a clinician. If the outcome is 'Message Taken', a task is automatically created in their task list."
- SCREEN: Select staff from dropdown, select "Message Taken" outcome
- SCREEN: Click "Save Call"
- NARRATION: "The call is recorded, a task is created for the clinician, and a note is added to the patient's episode."
- SCREEN: Show "Recent Calls" list on the right

**[4:00 - 5:00] SMS Reminders**
- SCREEN: Click "SMS Reminders" tab
- NARRATION: "Send bulk SMS reminders for tomorrow's appointments."
- SCREEN: Show tomorrow's appointment count, patients with/without phone numbers
- NARRATION: "Click Send Reminders to notify all patients with registered phone numbers."
- SCREEN: Click send button → show success message

**[5:00 - 5:30] Waitlist**
- SCREEN: Click "Waitlist" tab
- NARRATION: "The waitlist shows each patient's position, estimated wait time, and priority level."
- SCREEN: Show position numbers, estimated wait times, priority chips

**[5:30 - 6:00] Outro**
- NARRATION: "That's the receptionist workflow in Signacare. From check-in to phone triage to SMS reminders — everything is connected and notifications flow automatically to the clinical team."

---

## Video 2: Clinician / Psychiatrist Workflow (8 min)

### Title: "Signacare EMR — Clinician Daily Workflow"

**[0:00 - 0:30] Intro**
- NARRATION: "In this video, we'll cover the daily workflow for a clinician — viewing your dashboard, opening patients, writing notes, prescribing medications, and using AI tools."
- SCREEN: Login → Dashboard loads

**[0:30 - 1:30] Dashboard Overview**
- SCREEN: Show KPI cards with sparklines and trend arrows
- NARRATION: "Your dashboard shows key metrics at a glance. Each card has a sparkline showing the 7-day trend, and a percentage change from the previous period."
- SCREEN: Point out target progress bars (Appointments: 15/20 = 75%)
- NARRATION: "Click any card to navigate directly — for example, clicking Appointments takes you to the schedule."
- SCREEN: Show role switcher chips
- NARRATION: "If you have multiple roles, switch views using these chips."

**[1:30 - 2:30] My Clinic Today**
- SCREEN: Show Clinician view → My Clinic Today card
- NARRATION: "My Clinic Today shows your booked patients for the day with their last note summary."
- SCREEN: Click a patient name to navigate to their record
- NARRATION: "Click any patient to open their full record."

**[2:30 - 4:00] Patient Detail — Summary & Formulation**
- SCREEN: Patient detail page opens → Summary tab
- NARRATION: "The patient summary shows their clinical formulation, active medications, recent notes, and life chart."
- SCREEN: Scroll to Clinical Formulation section
- NARRATION: "Click Generate with AI to create a biopsychosocial formulation from the patient's clinical data."
- SCREEN: Click "Generate with AI" → show loading → show result
- NARRATION: "You can edit the formulation and save it. The AI uses your local Ollama model — no data leaves the clinic."

**[4:00 - 5:00] Prescribing**
- SCREEN: Click Medications tab
- NARRATION: "The medications tab shows current medications, history, prescriptions, LAI, clozapine monitoring, MAR chart, and side effects."
- SCREEN: Click "Prescribe" button
- NARRATION: "Only staff with a registered prescriber number can prescribe. Others see a locked button with a tooltip explaining how to get access."
- SCREEN: Show prescribe dialog → fill in medication, dose, frequency → Save

**[5:00 - 6:00] MAR Chart**
- SCREEN: Click "MAR Chart" subtab
- NARRATION: "The MAR chart auto-populates from active prescriptions with intelligent timing — BD medications appear at 08:00 and 20:00, nocte at 22:00."
- SCREEN: Click a scheduled time dot
- NARRATION: "Click to record administration. Choose status — Given, Refused, or Withheld. Select the context — Supervised, Self Administered, Inpatient, or Community."
- SCREEN: Show administration dialog → record as Given
- SCREEN: Toggle to Longitudinal view
- NARRATION: "Switch to Longitudinal view to see administration history over 7, 14, 30, or 90 days."

**[6:00 - 7:00] Alerts, Goals & Recovery Star**
- SCREEN: Click "Alerts & Plans" tab → Goals subtab
- NARRATION: "Set recovery goals with target dates. Track progress by clicking status chips."
- SCREEN: Click "Recovery Star" subtab
- NARRATION: "The Recovery Star visualises outcomes across 10 life domains. Adjust sliders and save."
- SCREEN: Adjust a slider → show score change

**[7:00 - 8:00] AI Tools & Voice Memo**
- SCREEN: Go to Drafts page
- NARRATION: "Record a voice memo — click Start Recording, speak your note, and the Whisper AI transcribes it."
- SCREEN: Click Start Recording → speak → Stop → show transcript
- NARRATION: "Edit the transcript and save as a draft note."
- SCREEN: Click "Save as Draft"
- NARRATION: "That's the clinician workflow. From dashboard to patient care to AI-assisted documentation — all in one system."

---

## Video 3: Mental Health Nurse — Inpatient Workflow (7 min)

### Title: "Signacare EMR — Nursing Inpatient Workflow"

**[0:00 - 0:30] Intro**
- NARRATION: "This video covers the nursing workflow for inpatient mental health — structured observations, NEWS2 scoring, medication administration, and shift handover."

**[0:30 - 1:30] Dashboard — Nursing View**
- SCREEN: Dashboard → switch to Nursing view
- NARRATION: "The nursing dashboard shows pending tasks, medication alerts, and a shift handover summary."

**[1:30 - 3:00] Structured Observations**
- SCREEN: Open patient → Inpatient Care tab → Observations
- NARRATION: "Record structured observations at the prescribed interval."
- SCREEN: Select level (15min / 30min / hourly)
- SCREEN: Enter location, mood, behaviour, sleep status, risk concerns
- SCREEN: Click Save → show in observation history table

**[3:00 - 4:00] NEWS2 Assessment**
- SCREEN: Click NEWS2 subtab
- NARRATION: "The NEWS2 calculator auto-scores vital signs. Adjust the sliders."
- SCREEN: Move sliders → show score changing colour (green → orange → red)
- NARRATION: "A score of 5 or above triggers an escalation alert recommending increased monitoring."
- SCREEN: Show escalation alert message
- SCREEN: Click Save Assessment → show in history

**[4:00 - 4:45] Falls Risk & Fluid Balance**
- SCREEN: Click Falls Risk subtab
- NARRATION: "Check applicable risk factors. The score auto-calculates."
- SCREEN: Check a few items → show score
- SCREEN: Click Fluid Balance subtab
- NARRATION: "Enter intake and output. Net balance is calculated automatically."

**[4:45 - 5:30] Wound Care**
- SCREEN: Click Wound Care subtab
- NARRATION: "Document wound assessments with site, type, size, exudate, dressing."
- SCREEN: Fill in form → Save → show in wound history

**[5:30 - 7:00] Shift Handover**
- SCREEN: Sidebar → Clinical Lists → Shift Handover
- NARRATION: "The handover page shows all patients in your caseload."
- SCREEN: Write notes for 2-3 patients
- NARRATION: "Click AI Summary to auto-generate a shift summary."
- SCREEN: Click AI Summary → show generated summary
- SCREEN: Click Save Handover
- NARRATION: "Each patient's note is saved to their individual record."
- SCREEN: Click Incoming Handover tab
- NARRATION: "The incoming tab shows handover notes from the previous shift, filtered to only your allocated patients."

---

## Video 4: Case Manager Workflow (5 min)

### Title: "Signacare EMR — Case Manager Workflow"

**[0:00 - 0:30] Intro**
- NARRATION: "This video covers the case manager workflow — managing your caseload, care plan goals, recovery outcomes, and community resources."

**[0:30 - 1:30] Caseload Dashboard**
- SCREEN: Dashboard → Case Mgmt view
- NARRATION: "Your caseload is displayed with RAG status — Red for overdue, Amber for at-risk, Green for on-track."
- SCREEN: Show RAG chips and patient list
- NARRATION: "Click any patient to open their record."

**[1:30 - 2:30] Patient List — Caseload Filter**
- SCREEN: Sidebar → Patients
- NARRATION: "The patient list automatically filters to show only your assigned patients."
- SCREEN: Show the clinician filter pre-set to the logged-in user

**[2:30 - 3:30] Care Plan Goals**
- SCREEN: Open patient → Alerts & Plans → Goals
- NARRATION: "Add recovery goals with type, target date, and progress tracking."
- SCREEN: Click Add Goal → fill in → Save
- SCREEN: Click status chips to update (Active → In Progress → Achieved)

**[3:30 - 4:30] Recovery Star**
- SCREEN: Click Recovery Star subtab
- NARRATION: "Rate the patient across 10 recovery domains. Each domain is scored 1-10."
- SCREEN: Adjust sliders → show average score and colour coding
- SCREEN: Click Save Recovery Star

**[4:30 - 5:00] Community Resources**
- SCREEN: Sidebar → Admin → Resources
- NARRATION: "Search the community resource directory for housing, NDIS, employment, crisis services."
- SCREEN: Search and browse resources

---

## Video 5: Clinic Manager — Reports & Analytics (6 min)

### Title: "Signacare EMR — Manager Reports & Analytics"

**[0:00 - 0:30] Intro**
- NARRATION: "This video covers the management dashboard and report builder — KPIs, staff caseload, DNA rates, and custom report generation."

**[0:30 - 1:30] Manager Dashboard**
- SCREEN: Dashboard → Manager view
- NARRATION: "The manager view shows contacts KPI, staff caseload, DNA rates, workload alerts, service statistics, and billing."
- SCREEN: Scroll through each card
- NARRATION: "Each metric is broken down by clinician with colour-coded indicators."

**[1:30 - 3:00] Admin Reports**
- SCREEN: Sidebar → Admin → Admin Reports
- NARRATION: "The Overview tab shows key metrics. Switch between Clinical Activity, Compliance, and Workforce tabs."
- SCREEN: Click through each tab
- NARRATION: "Click AI Summary to generate a narrative report using local AI."
- SCREEN: Click AI Summary → show generated text

**[3:00 - 5:00] Report Builder**
- SCREEN: Click Report Builder tab
- NARRATION: "The report builder lets you combine any metrics with different breakdowns."
- SCREEN: Select 3-4 metrics (click chips)
- SCREEN: Select "By Clinician" dimension
- SCREEN: Select "Bar Chart" visualisation
- SCREEN: Set date range to last 30 days
- SCREEN: Click Generate Report
- NARRATION: "Summary cards show top-level numbers. The bar chart breaks down each metric by clinician."
- SCREEN: Switch to Donut visualisation
- NARRATION: "The donut chart shows distribution proportions."
- SCREEN: Switch to Heatmap
- NARRATION: "The heatmap uses colour intensity to highlight high and low performers."
- SCREEN: Show Trend Detection panel
- NARRATION: "Trend detection automatically identifies variance and outliers."
- SCREEN: Click Export CSV → click Print/PDF
- SCREEN: Click AI Insights → show generated analysis

**[5:00 - 5:30] Scheduled Reports**
- SCREEN: Click Scheduled tab
- NARRATION: "Set up automatic reports that generate weekly or monthly and email to your team."
- SCREEN: Click New Schedule → fill in → Create

**[5:30 - 6:00] Outro**
- NARRATION: "That's the management reporting suite. From real-time KPIs to custom report building with AI insights."

---

## Video 6: ECT Workflow (5 min)

### Title: "Signacare EMR — ECT Module"

**[0:00 - 0:30] Intro**
- NARRATION: "This video covers the ECT module — course management, treatment recording, prescription, consent, assessments, and document uploads."

**[0:30 - 1:30] Creating an ECT Course**
- SCREEN: Open patient → ECT tab
- SCREEN: Click New ECT Course
- NARRATION: "Select the indication, electrode placement, pulse width, and frequency."
- SCREEN: Fill in anaesthetic protocol
- SCREEN: Click Create Course → show course in dropdown

**[1:30 - 2:30] Recording Treatment**
- SCREEN: Select course → Treatment Log tab
- SCREEN: Click Record Treatment
- NARRATION: "Complete pre-procedure checks, stimulus parameters, anaesthesia, seizure response, and recovery."
- SCREEN: Fill in key fields → Save

**[2:30 - 3:30] Prescription & Consent**
- SCREEN: Click Prescription tab → show prescriber gate
- NARRATION: "Only prescribers can create ECT prescriptions. The setting field specifies inpatient or community."
- SCREEN: Click Consent tab → select involuntary → show MHA fields
- NARRATION: "For involuntary patients, MHA requirements are displayed including tribunal notification and second opinion."

**[3:30 - 4:30] Assessments**
- SCREEN: Click Assessments tab
- NARRATION: "Five assessment types: Cognitive, Pre/Post Nursing, Pre/Post Medical."
- SCREEN: Show cognitive assessment → MMSE, MoCA, amnesia toggles
- SCREEN: Show pre-ECT nursing → vitals, fasting, consent checks

**[4:30 - 5:00] Documents & AI Summary**
- SCREEN: Click Documents tab → upload a consent form
- SCREEN: Click AI Summary button → show generated course summary

---

## Recording Tips

1. **Resolution**: Record at 1920x1080 (16:9)
2. **Browser**: Use Chrome or Safari in full screen
3. **Demo data**: Ensure demo patients have data in all relevant tabs
4. **Mouse movements**: Move slowly and deliberately
5. **Pauses**: Pause 1-2 seconds on each important screen
6. **Narration**: Speak slowly and clearly, ~150 words per minute
7. **Editing**: Cut out login delays and loading spinners in post-production
8. **Branding**: Show the Signacare logo in the sidebar throughout

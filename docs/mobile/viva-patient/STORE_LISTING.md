# Viva by Signacare — Store Listings

**Bundle ID / Application ID:** `com.signacare.viva`
**Category:** Health & Fitness (primary), Medical (secondary)
**Content rating target:** 17+ (iOS) / Mature 17+ (Play) — mental health content
**Audience:** Patients of clinics using Signacare EMR. Public-listing app.

---

## 1. App Store Connect (iOS)

### Name
`Viva by Signacare`

### Subtitle (30 chars max)
`Your mental health companion`

### Promotional text (170 chars)
`Track mood, sleep, and medications. Message your care team. Attend appointments by video. Your clinic-held records, under your control.`

### Description (4000 chars)

```
Viva is the patient companion app for clinics that use the Signacare mental health EMR. It helps you stay connected to your care team between appointments, track how you're feeling day to day, and take an active role in your own recovery.

WHAT VIVA DOES

• Daily mood and sleep tracking — quick sliders you can tap in under 10 seconds. Your clinical team sees the trends in their own dashboard.

• Journaling — private entries that stay on your device, with an option to share specific entries with your clinician if you want to.

• Appointment reminders — Viva reminds you 24 hours and 1 hour before each booked appointment, and gives you one-tap access to join video consultations.

• Medication reminders — your clinic can set up reminders for each medication so you know when to take them.

• Secure messaging — message your care team inside the app. Messages are protected by the same encryption your clinic uses for clinical notes.

• Your care plan — see the goals you're working on with your clinician, and mark off progress.

WHO THIS IS FOR

Viva is for people who are current patients of a clinic that uses the Signacare EMR. Your clinic's staff will help you activate the app with an access code.

If you're not a current patient of a clinic running Signacare, Viva won't work — there's no sign-up flow; clinics enrol you. Ask your clinic if they support Viva.

YOUR PRIVACY MATTERS

Viva is designed so your clinic — not Signacare — controls your data. Your journal, mood scores, and messages are stored on your clinic's own Signacare server, which may be on-premises at the clinic or in a cloud under their control.

Signacare the company does not receive your health information. All communication runs over TLS. You can delete entries, revoke clinic access to a specific journal entry, and export everything at any time.

NOT A CRISIS TOOL

Viva is a between-appointments companion, not a crisis line. If you are in immediate distress, please call Lifeline (13 11 14) or triple zero (000) in Australia, or your local emergency number.

SUPPORT

support@signacare.au

Made in Australia.
```

### Keywords
`mental health,mood,journal,wellbeing,therapy,recovery,appointments,reminders`

### Support URL
`https://signacare.au/support`

### Marketing URL
`https://signacare.au/viva`

### Privacy Policy URL (**required**)
`https://signacare.au/privacy/viva`

### Primary category
`Health & Fitness`

### Secondary category
`Medical`

### Age rating
- Infrequent mild medical/treatment information: **Yes**
- Distressing themes: **Infrequent/Mild** (safety plans reference self-harm risk factors)
- Result: **17+**

### Screenshots
Same required sizes as Sara. Content plan:

1. Onboarding / clinic activation code entry
2. Daily mood check-in
3. Sleep tracking graph
4. Appointment reminder / join video consult
5. Secure messaging with a care team
6. Journal entry with "share with clinician" toggle

### App Privacy (Nutrition Label)

| Data type | Collected? | Linked to identity? | Used for tracking? |
|---|---|---|---|
| Contact info (name, email) | Yes | Yes | No |
| Health & fitness (mood, sleep, medications, clinical notes) | Yes (stored on clinic server) | Yes | No |
| User content (journal, messages) | Yes (stored on clinic server) | Yes | No |
| Identifiers — user ID | Yes | Yes | No |
| Diagnostics — crash logs | Yes (PHI-scrubbed) | No | No |

Same principle as Sara: no third-party sharing, no tracking, no ads.

### Export compliance
`ITSAppUsesNonExemptEncryption: false` — standard HTTPS/TLS only.

### Review demo account

- `reviewer-patient@signacare.au` / strong password
- Pre-populated with 2 weeks of synthetic mood data, 3 appointments, 2 messages

> Viva is a patient companion app for licensed mental health clinics. Enrolment is via a clinic-issued access code — this reviewer account has been pre-enrolled on the Signacare staging server. All data shown is synthetic. The app does not collect payment information, does not show ads, and does not share data with third parties.

---

## 2. Google Play Console (Android)

### Application ID
`com.signacare.viva`

### App name
`Viva by Signacare`

### Short description
`Mental health companion for patients of Signacare-powered clinics.`

### Full description
Use the same long-form description as App Store Connect above.

### Data safety (Play Console)

Same disclosure as App Store. Permissions declared:
- `INTERNET` / `ACCESS_NETWORK_STATE` — app functionality
- `USE_BIOMETRIC` / `USE_FINGERPRINT` — session unlock
- `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM` — local appointment and medication reminders
- `VIBRATE` — reminder haptic

**Does not collect**: location, SMS, camera, mic, contacts, files.

### Content rating (IARC)
- References to self-harm (as part of safety plans): Yes, mild
- Result: **PEGI 16 / ESRB Teen** with mental health content disclaimer.

### Target audience
- Primary target age: 18+
- May also appeal to teens (13-17): check with legal — mental health context may require additional COPPA / children's privacy disclosures if teens are in scope
- **For the initial launch, target 18+ only**.

### Release strategy
Internal → Closed → Production, same as Sara. Australia-only at launch.

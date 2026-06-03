# Sara by Signacare — Store Listings

**Bundle ID / Application ID:** `com.signacare.sara`
**Category:** Medical (primary), Productivity (secondary)
**Content rating target:** 17+ (iOS) / Mature 17+ (Play) — medical information
**Audience:** Registered clinicians using Signacare EMR. NOT a general-public app.

---

## 1. App Store Connect (iOS)

### Name
`Sara by Signacare`

### Subtitle (30 chars max)
`Clinician companion for EMR`

### Promotional text (170 chars, updatable without review)
`Voice-to-SOAP scribing, patient list, clinical notes, and medication management — all running locally against your clinic's Signacare server. No cloud PHI.`

### Description (4000 chars)

```
Sara is the mobile clinician companion for the Signacare mental health EMR. It gives psychiatrists, psychologists, mental health nurses, and allied health clinicians a phone-first interface to the tools they use dozens of times a day:

• Voice-to-SOAP scribing — record a consultation, watch the transcript stream back from your clinic's on-prem Whisper instance, and have the structured SOAP note drop into the draft queue for your sign-off. No audio leaves your clinic's network.

• Patient list and chart access — pull up any patient from your caseload with trigram fuzzy search (nickname variants, typos, partial names). Every chart is scoped to your clinic via database-level row-level security.

• Clinical notes — review, amend, and sign notes on the move. Optimistic locking prevents silent overwrites when another clinician is editing the same note from the desktop.

• Medication management — MAR (medication administration record) with intelligent frequency scheduling, side-effect monitoring, prescribing contraindications, and an active allergy list.

• Risk and safety — review the patient's most recent risk assessment and safety plan without context-switching.

• Quick-insert macros — Alt+Shift+P/R/O/V/M/A on external keyboards pulls pathology, risk, outcomes, vitals, medications, and allergies straight into the SOAP field you're typing in, with provenance citations.

• Biometric login — Face ID or Touch ID secures the app between sessions.

• Offline-tolerant — notes you start in the field sync the moment you're back on the clinic network. No data loss on flaky mobile coverage.

SECURITY & PRIVACY

Sara is designed for use inside a clinic that runs its own Signacare server — either on-prem or on a private cloud under the clinic's control. Your clinic's admin configures the server URL when you first install the app; there is no Signacare-hosted cloud for clinical data, and Signacare the company never sees your patient information.

All traffic runs over TLS. Identifiers (Medicare, IHI, DVA) are encrypted at rest with AES-256-GCM. Every action is audit-logged on the server with a SHA-256 hash chain so tampering is detectable. Break-glass emergency access requires a second senior clinician to approve.

REQUIREMENTS

• A Signacare EMR installation — ask your clinic admin for the server URL.
• A clinician account on that server (Sara will not work with an unauthorised email).
• iOS 14.5 or later for the microphone scribing feature.

NOT FOR PATIENT USE

Sara is for registered clinicians only. If you are a patient looking for the Signacare patient companion app, please install "Viva by Signacare" instead.

SUPPORT

support@signacare.au
https://signacare.au/support

Made in Australia.
```

### Keywords (100 chars, comma-separated)
`EMR,clinician,mental health,psychiatry,medical notes,SOAP,medication,MAR,voice dictation,biometric`

### Support URL
`https://signacare.au/support`

### Marketing URL
`https://signacare.au/sara`

### Privacy Policy URL (**required**)
`https://signacare.au/privacy/sara`
See `docs/mobile/sara-clinician/PRIVACY_POLICY.md` for the source.

### Copyright
`© 2026 Signacare PTY Ltd`

### Primary category
`Medical`

### Secondary category
`Productivity`

### Age rating
- Medical / treatment information: **Frequent / Intense**
- All other categories: **None**
- Result: **17+**

### Screenshots — required sizes

| Device | Size | Count |
|---|---|---|
| iPhone 6.9" (iPhone 15 Pro Max) | 1320 × 2868 | 3-10 |
| iPhone 6.7" (iPhone 14 Pro Max) | 1290 × 2796 | 3-10 (optional if 6.9 provided) |
| iPad Pro 13" M4 | 2064 × 2752 | 3-10 (required if the app supports iPad) |
| iPad Pro 12.9" 6th gen | 2048 × 2732 | 3-10 (optional if 13" M4 provided) |

Screenshot content plan:
1. Login screen with biometric option (no real credentials)
2. Patient list with synthetic test data (use `Test Patient`, never real names)
3. Clinical note editor with SOAP fields and the quick-insert macro help
4. Medication administration record (MAR) with a synthetic patient
5. Risk / safety plan review
6. Scribe recording screen with live transcript (use a demo consultation)

**All screenshots must use synthetic patient data.** Apple review will reject real PHI, and you'll lose 2-3 days to re-review.

### App Preview video (optional)
15-30 seconds showing login → patient search → scribe recording → SOAP draft.

### App Privacy (Nutrition Label)

| Data type | Collected? | Linked to identity? | Used for tracking? |
|---|---|---|---|
| Contact info — name, email | Yes (account login only) | Yes | No |
| Health & fitness — clinical records | Yes (the user is a clinician viewing/editing patient records) | Yes | No |
| User content — audio recordings, notes | Yes (uploaded to the clinic server only) | Yes | No |
| Identifiers — user ID | Yes | Yes | No |
| Diagnostics — crash logs, usage data | Yes (Sentry, PHI-scrubbed) | No | No |

**Data is not used for tracking, advertising, or analytics sharing with third parties.** The clinic's own server holds all clinical data; Signacare the company does not receive patient information.

### Export compliance
`ITSAppUsesNonExemptEncryption: false` is declared in [Info.plist](../../apps/mobile/ios/Runner/Info.plist) — Sara uses only standard HTTPS/TLS which is exempt under US EAR §740.17(b)(1). No annual self-classification required.

### App Store Review Information

- **Demo account**: `reviewer@signacare.au` / `ReviewAcc3ss!` (provision on the staging server before submission; rotate on accept)
- **Demo server URL**: `https://staging.signacare.au`
- **Notes to reviewer**:
  > Sara is a clinical companion app for licensed mental health clinicians using the Signacare EMR. A demo account has been provisioned with synthetic patient data. The app connects to your clinic's Signacare server (URL configured at first launch) — there is no Signacare-hosted cloud. All patient data shown in the demo is synthetic.
  >
  > Microphone permission is used for voice-to-SOAP note dictation. Camera permission is used for document scanning. Face ID is used for biometric session unlock. Photo library permission is used for attaching images to clinical notes.
  >
  > If you encounter any issue logging in, please email `reviewer-support@signacare.au` for immediate assistance.

---

## 2. Google Play Console (Android)

### Application ID
`com.signacare.sara`

### App name (30 chars)
`Sara by Signacare`

### Short description (80 chars)
`Mobile clinician companion for the Signacare mental health EMR platform.`

### Full description (4000 chars)
Use the same long-form description as App Store Connect above.

### Graphics

| Asset | Size | Count |
|---|---|---|
| App icon | 512 × 512 PNG (32-bit, alpha) | 1 |
| Feature graphic | 1024 × 500 PNG | 1 |
| Phone screenshots | min 1080 × 1920 (9:16 or 16:9) | 2-8 |
| 7" tablet screenshots | min 1080 × 1920 | 1-8 optional |
| 10" tablet screenshots | min 1080 × 1920 | 1-8 optional |

### Content rating (Google Play IARC questionnaire)

- Medical / treatment information: Yes
- Violence: No
- Sexual content: No
- Profanity: No
- User-generated content: Yes (clinicians write notes)
- Shares location: No
- Digital purchases: No

Expected rating: **PEGI 16 / ESRB Teen** with medical information disclaimer.

### Target audience and content
- **Target age**: 18+ (licensed clinicians)
- **Appeals to children**: No
- **COPPA applicable**: No

### Data safety

Same disclosure as App Store Privacy Nutrition Label — restate in Google Play's format:

| Data collected | Purpose | Optional? | Encrypted in transit | Can delete |
|---|---|---|---|---|
| Name, email | Account management | No | Yes | Via clinic admin |
| Clinical content (notes, audio) | App functionality | No | Yes | Via clinic admin |
| App activity | Analytics (Sentry, PHI-scrubbed) | No | Yes | No (diagnostic) |
| Device ID | App functionality (session binding) | No | Yes | On uninstall |

**Not collected**: location, personal financial info, photos/videos unrelated to clinical notes, contacts, calendar, SMS/call log, advertising ID.

### Privacy policy URL (**required**)
`https://signacare.au/privacy/sara`

### Permissions justification (required for sensitive perms)

| Permission | Justification |
|---|---|
| `RECORD_AUDIO` | Voice-to-SOAP note dictation during consultations. Audio is uploaded to the user's clinic server only; never to a third party. |
| `CAMERA` | Document scanning and clinical image capture, attached to patient records on the clinic server. |
| `USE_BIOMETRIC` | Session unlock via fingerprint or face authentication. |

### Release type
- **Internal testing** first: 1 tester account, 30-minute propagation.
- **Closed testing** next: beta cohort of 10-20 clinicians from design-partner clinics.
- **Production**: gated on beta feedback + 2-week review.

### Countries
**Initially**: Australia only. Expand to NZ, UK, and Canada after Australian clinical validation is complete.

### Pricing
Free (but the app is unusable without a Signacare clinic server subscription).

### Ads
**No.** This is a clinical tool. Declare "No" to the ads question during submission.

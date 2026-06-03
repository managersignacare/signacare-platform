# Viva by Signacare — App Store & Play Store Submission Checklist

**Owner:** Mobile release lead
**Cadence:** Every major release (x.0.0).

Viva's submission process is structurally identical to Sara's — see [docs/mobile/sara-clinician/SUBMISSION_CHECKLIST.md](../sara-clinician/SUBMISSION_CHECKLIST.md) for the full workflow. This file lists **only the Viva-specific deltas**.

---

## 1. Developer account

Share the same Apple Developer Program and Google Play Console organisation as Sara — Signacare ships both apps under one legal entity. No additional accounts needed.

## 2. Viva-specific metadata

### iOS

- Bundle ID: `com.signacare.viva` (distinct from Sara's `com.signacare.sara`)
- Primary category: **Health & Fitness** (Sara is Medical)
- Age rating: **17+** — references to self-harm in the safety-plan surface
- Content from [STORE_LISTING.md](STORE_LISTING.md)
- Privacy policy URL: `https://signacare.au/privacy/viva`
- Review demo account: `reviewer-patient@signacare.au` with a synthetic patient profile pre-enrolled on the staging Signacare server

### Android

- Application ID: `com.signacare.viva`
- Play Store category: **Health & Fitness**
- Data safety disclosure: Viva collects LESS than Sara — **no microphone, no camera, no photo library**. Make sure the Play Console data safety form reflects that.
- Content rating: PEGI 16 / ESRB Teen — mental health content.
- Target audience 18+ at initial launch.

## 3. Signing

Separate upload keystore from Sara — **do not share keystores between apps**. Losing a shared keystore would block both apps at once.

```bash
cd apps/patient-app/android
keytool -genkey -v \
  -keystore signacare-viva-upload.jks \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -alias upload \
  -dname "CN=Signacare PTY Ltd, O=Signacare, C=AU"
```

`key.properties` lives at `apps/patient-app/android/key.properties` and is covered by the root `.gitignore`. Content is the same format as Sara's.

## 4. Viva-specific review notes

Apple and Google both pay extra attention to mental health apps. Flag the following in the review notes:

- Viva is **not a crisis line**. A prominent crisis-line banner is shown on first launch and in the Help screen, surfacing Lifeline (AU), 1737 (NZ), Samaritans (UK), 988 (US) depending on the clinic's country.
- Viva does **not** use peer-to-peer messaging — all messages are routed through the clinic's Signacare server with clinician-side moderation.
- Viva is **enrolment-only** — there is no public sign-up flow. Reviewers use the provided demo access code.
- Viva handles self-harm content ONLY inside the "Safety Plan" surface, where it is a clinician-populated list (warning signs, internal coping strategies, support contacts, crisis-service numbers). It does not surface self-harm content independent of that workflow.

## 5. Post-launch monitoring

Same Sentry + Play Console Vitals + App Store Connect dashboards as Sara. Viva-specific alerts:

- **"reminder failed to fire"** — Android background restrictions on Samsung / Xiaomi devices often break exact-alarm scheduling. Monitor Play Console "ANR and crashes" AND the clinic-side "patient missed a reminder" metric.
- **Safety-plan view impressions** — not personally identifying, just a count. Helps the clinical team know if patients are looking at their safety plans in moments of distress.

## 6. Artefacts on file per release

Same six items as Sara, stored under `docs/mobile/viva-patient/releases/<version>/`.

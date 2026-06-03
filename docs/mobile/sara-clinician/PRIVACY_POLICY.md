# Sara by Signacare — Privacy Policy

**Effective date:** (set at publication)
**Last reviewed:** 2026-04-12

This policy describes how the Sara by Signacare mobile app ("Sara") handles personal information. Sara is the clinician companion app for the Signacare EMR platform used by licensed mental health clinicians to access their clinic's patient records.

**This is a template. Before publishing, replace every `[placeholder]` with your clinic or organisation's details. Have a lawyer review this document against the Australian Privacy Act 1988, the Health Records Act (state-specific where applicable), and any other jurisdiction where you plan to list the app.**

---

## 1. Who we are

Sara is developed and distributed by:

> Signacare PTY Ltd
> ABN [ABN]
> [Registered office address]
> Contact: privacy@signacare.au

Signacare is the **app publisher**. We do not operate a cloud service that stores patient data. Every copy of Sara connects to a clinic-operated Signacare EMR server — the clinic (not Signacare) is the data controller for patient information.

## 2. Who the app is for

Sara is for **licensed clinicians** who work at a clinic that has deployed the Signacare EMR. It is not a general-public application. If you are a patient of a clinic that uses Signacare, please see the Viva by Signacare patient app instead.

## 3. What information the app processes

### 3.1 On your device (clinician)

When you install and use Sara on your phone or tablet, the app holds the following on your device:

- **Your clinic account email and encrypted session tokens** (stored in iOS Keychain / Android Keystore)
- **Biometric enrolment flag** (whether you enabled Face ID / Touch ID / fingerprint unlock — not the biometric data itself, which never leaves your device's secure enclave)
- **The server URL your clinic admin configured**
- **A short-lived in-memory cache of the records you are currently viewing** — cleared when you close the app or the session times out (60 minutes of inactivity)
- **Partial voice transcripts during active scribing** — uploaded to your clinic server and then discarded from memory
- **Crash diagnostics** sent to our error-reporting service (Sentry) with all personal health information automatically scrubbed before transmission

### 3.2 On your clinic's server

When you use Sara, it sends API calls to **your clinic's own Signacare server**. That server stores the patient records, clinical notes, medications, scribe audio, and every other clinical artefact. Your clinic (not Signacare) is the data controller for those records.

Signacare the company does **not** receive, store, or have access to patient information. We have no cloud endpoint that patient data passes through.

### 3.3 What we as the app publisher receive

The only data that flows from Sara to Signacare PTY Ltd is:

- **Crash diagnostics** via Sentry — exception stack traces and device metadata, with personal health information automatically redacted before transmission
- **App Store / Google Play analytics** that Apple and Google compute automatically (installs, crashes, retention) — we do not receive user-identifying information from these

## 4. How we use information

- **To deliver the app's functionality** — every API call from Sara goes to your clinic's server, so the clinic can authenticate you and return the records you are authorised to see
- **To detect and fix software defects** — crash diagnostics with PHI removed
- **To comply with Apple and Google requirements for app distribution** — e.g. age rating, export compliance

We do **not**:

- Sell your data to anyone
- Use your data for advertising
- Share your data with marketers or data brokers
- Track you across other apps or websites
- Build profiles about you
- Train machine-learning models on your data

## 5. Permissions Sara requests

### iOS

| Permission | Why Sara needs it | When it's asked |
|---|---|---|
| Microphone | Voice-to-SOAP dictation during consultations | First time you tap the record button |
| Camera | Scanning documents and capturing clinical images | First time you open the camera attachment |
| Photo library | Attaching existing images to a clinical note | First time you attach a photo |
| Face ID | Biometric unlock of the app between sessions | When you enable biometric unlock in settings |
| Local network | Reaching your clinic's server on the local LAN | First launch if you configure an on-prem server |

### Android

| Permission | Why Sara needs it |
|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | Talking to your clinic's server |
| `USE_BIOMETRIC` | Fingerprint / face unlock of the app |
| `RECORD_AUDIO` | Voice-to-SOAP dictation |
| `CAMERA` | Document scanning and clinical image capture |

Sara does not request location, contacts, calendar, SMS, call log, or advertising ID. Declining any optional permission leaves the app functional — only the corresponding feature becomes unavailable.

## 6. How we protect information

- **Transport security**: every API call runs over TLS 1.2 or 1.3. Cleartext HTTP is blocked at the OS level via `NSAppTransportSecurity` (iOS) and `network_security_config` (Android); only `localhost` and `127.0.0.1` are exempted for development purposes.
- **At-rest encryption on your device**: session tokens live in the iOS Keychain or Android Keystore, both of which use hardware-backed encryption where available.
- **Session timeout**: Sara invalidates your session after 60 minutes of inactivity. You must re-authenticate to continue.
- **Biometric unlock**: optional. When enabled, the app requires Face ID / Touch ID / fingerprint on every launch, even within the session window.
- **PHI scrubbing in diagnostics**: crash logs are run through a PHI-scrubbing layer that strips names, Medicare / IHI / DVA numbers, dates of birth, emails, and phone numbers before transmission.

For the full security architecture of the Signacare EMR, see [docs/ENTERPRISE_FEATURES.md](../ENTERPRISE_FEATURES.md) and [docs/INFORMATION_SECURITY_POLICY.md](../INFORMATION_SECURITY_POLICY.md).

## 7. Your rights

Because the clinic — not Signacare — holds your clinical data, most data-subject requests are handled by the clinic:

- **Access** to your clinical records: contact your clinic's privacy officer.
- **Correction** of an error in your clinical record: contact your clinic's privacy officer.
- **Deletion** of your account: ask your clinic admin to deactivate it.

For the narrow slice Signacare handles (crash diagnostics), you can:

- **Ask us to delete any data Sentry holds about your device** by emailing `privacy@signacare.au` with the device identifier shown in Sara's *Settings → About* screen.
- **Ask what we hold** about your device: same email.

## 8. Data retention

- **On your device**: session tokens expire after 7 days; partial transcripts are cleared when you close the app.
- **In Sentry (crash diagnostics)**: 90 days, then automatically purged.
- **On your clinic's Signacare server**: retention follows the clinic's own data retention policy, which defaults to 7 years for clinical records to satisfy Australian medical record-keeping obligations. Contact your clinic admin for the exact policy.

## 9. Children

Sara is for licensed clinicians. It is not directed at children and is not available on any app store in a category that targets children. If you believe a child has installed Sara, please contact `privacy@signacare.au` and we will help the child delete the app.

## 10. International transfers

Crash diagnostics sent to Sentry are processed on servers located in the European Union. No other data leaves the region where your clinic's Signacare server is hosted. If your clinic's server is in Australia (the default), your clinical data stays in Australia.

## 11. Notifiable data breaches

If a data breach involving Signacare's own infrastructure occurs and meets the threshold for notification under the Australian Privacy Act 1988 Part IIIC (Notifiable Data Breaches scheme), we will:

1. Notify the Office of the Australian Information Commissioner (OAIC) within the statutory 30 days.
2. Notify affected users or — where the breach involves patient data on a clinic's server — the clinic administrator so they can notify their patients.

Breaches on a clinic's own server are the clinic's responsibility to notify; Signacare will assist as technical partner.

## 12. Changes to this policy

We will update this policy when the app changes in a way that affects privacy. The "last reviewed" date at the top of the document always reflects the most recent revision. Material changes will be announced in the app on next launch.

## 13. How to contact us

- **Privacy questions**: `privacy@signacare.au`
- **Security vulnerabilities**: `security@signacare.au` (see our security.txt file at `https://signacare.au/.well-known/security.txt`)
- **App support**: `support@signacare.au`

If you are unhappy with how we handle your request, you can lodge a complaint with the Office of the Australian Information Commissioner — https://www.oaic.gov.au/.

---

*End of privacy policy. Publish at `https://signacare.au/privacy/sara`.*

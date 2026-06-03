# Viva by Signacare — Privacy Policy

**Effective date:** (set at publication)
**Last reviewed:** 2026-04-12

Viva is the patient companion app for the Signacare mental health EMR. This policy describes how Viva handles your information.

**This is a template. Replace every `[placeholder]` before publishing, and have a privacy lawyer review it against the Australian Privacy Act 1988, the NDB scheme, and any other jurisdiction where you list the app.**

---

## 1. Who we are

> Signacare PTY Ltd
> ABN [ABN]
> [Registered office address]
> Contact: privacy@signacare.au

Signacare PTY Ltd is the **app publisher**. Your clinic is the **data controller** for your clinical records — we do not host or have access to your health data.

## 2. How the app works

Viva connects to your clinic's Signacare EMR server. That server (not Signacare) stores your records. When you open Viva, it asks your clinic's server "show me my mood check-ins, my journal, my appointments", and the server returns them. We never see those records.

## 3. Information held on your device

- Your encrypted session tokens (iOS Keychain / Android Keystore)
- Your preferences (reminder times, biometric unlock on/off)
- A short local cache of recent mood check-ins and journal entries — cleared when you log out

## 4. Information held on your clinic's server

- Your mood / sleep / medication check-ins
- Your journal entries (and the clinician-sharing flag per entry)
- Appointments, reminders
- Secure messages between you and your care team
- Your care plan, goals, and progress

Your clinic's privacy policy governs what happens to those records. Ask your clinic for their policy; they will have one on request.

## 5. Information we (Signacare) receive

- **Crash diagnostics** via Sentry — PHI-scrubbed before transmission
- App Store / Play Store install and crash metrics that Apple and Google compute automatically

We do **not**:
- Sell or rent your data
- Show ads
- Share data with marketers or data brokers
- Track you across apps or websites
- Train machine-learning models on your data

## 6. Permissions

### iOS

- **Face ID / Touch ID** (optional) — unlock the app without typing your password. The biometric itself never leaves your device.
- **Notifications** — appointment and medication reminders. You can turn these off in system settings.
- **Local network** — reach your clinic's server on your home Wi-Fi if your clinic runs an on-prem installation.

### Android

- `INTERNET`, `ACCESS_NETWORK_STATE` — talk to your clinic's server
- `USE_BIOMETRIC` / `USE_FINGERPRINT` — biometric unlock
- `RECEIVE_BOOT_COMPLETED`, `SCHEDULE_EXACT_ALARM` — schedule appointment and medication reminders
- `VIBRATE` — reminder haptic feedback

Viva **does not** request microphone, camera, photos, location, contacts, calendar, SMS, call log, or advertising ID.

## 7. Security

- TLS 1.2 or 1.3 on every network call
- Cleartext HTTP blocked at the OS level (App Transport Security on iOS, `network_security_config` on Android — see [apps/patient-app/android/app/src/main/res/xml/network_security_config.xml](../../apps/patient-app/android/app/src/main/res/xml/network_security_config.xml))
- Session tokens stored in hardware-backed keystores
- Session timeout after 60 minutes of inactivity
- Biometric unlock optional per user

For full security architecture see [docs/ENTERPRISE_FEATURES.md](../ENTERPRISE_FEATURES.md) and [docs/INFORMATION_SECURITY_POLICY.md](../INFORMATION_SECURITY_POLICY.md).

## 8. Your rights

Because your clinic holds the clinical data, most rights requests are handled by your clinic:

- **Access** your records: ask your clinic's privacy officer.
- **Correct** an error: ask your clinic's privacy officer.
- **Delete** your account: ask your clinic admin to deactivate it. The app data on your device can be wiped by deleting Viva.
- **Export** your data: use Viva's built-in export (Settings → Export my data), which asks the clinic server for a full JSON export. Your clinic can also export your record under their own privacy policy.

For diagnostic data Signacare holds (Sentry crash logs), email `privacy@signacare.au` and cite your device ID from the About screen.

## 9. Not a crisis service

**Viva is not a crisis line.** If you are in immediate distress:

- **Australia**: Lifeline 13 11 14 or 000
- **New Zealand**: 1737 or 111
- **UK**: Samaritans 116 123 or 999
- **US**: 988 Suicide & Crisis Lifeline

Please do not rely on Viva messages or journal entries to summon emergency help.

## 10. Children

Viva is for patients aged 18+ at launch. If your clinic enrols a minor, they do so under their own parental-consent processes — Signacare does not verify age itself.

## 11. Data retention

- On your device: cleared on logout or app delete
- Sentry diagnostics: 90 days
- On your clinic's server: per your clinic's retention policy (typically 7 years for Australian medical records)

## 12. International transfers

Sentry processes diagnostics in the EU. Everything else stays in whatever region your clinic's Signacare server is hosted — Australia by default.

## 13. Notifiable breaches

Clinic-side breaches are notifiable by the clinic under the Australian Privacy Act 1988 Part IIIC. Breaches on our (Signacare) infrastructure — limited to the Sentry diagnostic path — are notified by us to the OAIC within the statutory 30 days and to affected users where possible.

## 14. Contacts

- Privacy: `privacy@signacare.au`
- Security: `security@signacare.au`
- Support: `support@signacare.au`
- OAIC: https://www.oaic.gov.au/

## 15. Changes

We will update this policy when the app changes in a way that affects your privacy. The "last reviewed" date is updated each revision. Material changes are announced in-app on next launch.

---

*End of Viva privacy policy. Publish at `https://signacare.au/privacy/viva`.*

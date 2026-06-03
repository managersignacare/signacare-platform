# Sara by Signacare — App Store & Play Store Submission Checklist

**Owner:** Mobile release lead
**Cadence:** Every major release (x.0.0). Point releases (x.y.0) skip §1–§3 if nothing in them has changed.
**First use:** 2026-04-12 (S8.2 preparation for initial App Store + Play Store launch)

Tick every item in order. Skipping an item has historically cost 2-3 days of re-review turnaround.

---

## 1. Developer account prerequisites (one-time)

### Apple

- [ ] **Apple Developer Program membership** (Organisation, not Individual) — AUD 149/year
  - Requires a D-U-N-S number for Signacare PTY Ltd
  - Requires the Signacare legal entity ABN
  - Approval takes 1-3 business days
- [ ] **Signacare PTY Ltd legal entity verified** in App Store Connect
- [ ] **Tax and banking** configured (only needed if charging — Sara is free, so skip)
- [ ] **App Store Connect roles** assigned:
  - Account Holder: CEO
  - Admin: Mobile release lead, ops lead
  - App Manager: Each mobile engineer who runs a release
  - No "Developer" role needed — keep the blast radius small

### Google

- [ ] **Google Play Console organisation account** — USD 25 one-time
  - Requires D-U-N-S + legal entity verification for apps in the "Health & Fitness" / "Medical" category
  - Identity verification takes 1-2 business days
- [ ] **Play Console user roles** assigned:
  - Account owner: CEO
  - Admin: Mobile release lead
  - Release manager: Each mobile engineer who runs a release
- [ ] **Play App Signing enrolled** — Google holds the app signing key. You upload a release artifact signed with an upload key; Google re-signs with the app signing key. This is how you recover from an upload-key compromise.

## 2. Assets and metadata (per release)

### Shared

- [ ] Version number bumped in `apps/mobile/pubspec.yaml` (`version: X.Y.Z+BUILD` — the `+BUILD` number is the Play versionCode and the CFBundleVersion).
- [ ] Release notes drafted — max 4000 chars, bullet format, links to full changelog.
- [ ] Synthetic test patient data loaded on the staging Signacare server — **no real PHI in screenshots or review demo account**.

### iOS

- [ ] App icon 1024×1024 PNG (no alpha, no transparency) at `apps/mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/`.
- [ ] Launch screen up to date in `apps/mobile/ios/Runner/Base.lproj/LaunchScreen.storyboard`.
- [ ] Screenshots for iPhone 6.9" (1320×2868) — 3 to 10 PNGs, no alpha.
- [ ] Screenshots for iPad 13" M4 (2064×2752) — 3 to 10 PNGs (if the app supports iPad).
- [ ] App Preview video (optional) — 15-30 seconds, under 500 MB.
- [ ] Store listing content pulled from [STORE_LISTING.md §1](STORE_LISTING.md) and pasted into App Store Connect.
- [ ] Privacy Policy URL live at `https://signacare.au/privacy/sara` — content from [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
- [ ] Support URL live at `https://signacare.au/support`.
- [ ] **Export compliance** — `ITSAppUsesNonExemptEncryption = false` in `apps/mobile/ios/Runner/Info.plist` (already set in S8.2).
- [ ] **App Privacy (Nutrition Label)** — enter the data collection map from STORE_LISTING.md §1 "App Privacy".
- [ ] **Age rating** computed via the Apple questionnaire → 17+.
- [ ] **Demo account** for Apple review:
  - `reviewer@signacare.au` / strong password
  - Provisioned on the staging server with clinician role and ~10 synthetic patients
  - Rotate the password on accept

### Android

- [ ] App icon 512×512 PNG (32-bit with alpha).
- [ ] Feature graphic 1024×500 PNG.
- [ ] Phone screenshots ≥1080×1920 — 2 to 8.
- [ ] Tablet screenshots (optional) if you want to be featured in the tablet store.
- [ ] Store listing content pulled from [STORE_LISTING.md §2](STORE_LISTING.md).
- [ ] Privacy Policy URL live.
- [ ] **Data safety form** completed in Play Console using the map in STORE_LISTING.md §2 "Data safety".
- [ ] **Content rating** questionnaire completed → PEGI 16 / Teen with medical information disclaimer.
- [ ] **Target audience** set to "18+" — NOT "Everyone" (this is a clinical app, not a game).
- [ ] **App category** set to "Medical" (not "Health & Fitness" — Medical has stricter review but it's the right bucket).

## 3. Release signing

### iOS — Xcode archive + upload

- [ ] `apps/mobile/ios/Runner.xcworkspace` opens cleanly in Xcode.
- [ ] Signing team set to **Signacare PTY Ltd** (organisation team, not personal).
- [ ] Bundle ID `com.signacare.sara` registered in Apple Developer portal.
- [ ] Distribution provisioning profile created (App Store Distribution).
- [ ] Archive: `Product → Archive` from Xcode (must be a physical device target, not simulator).
- [ ] Archive validated via `Organiser → Validate App` — fixes any missing privacy strings, missing assets, or entitlement mismatches BEFORE upload.
- [ ] Upload to App Store Connect via `Organiser → Distribute App → App Store Connect → Upload`.
- [ ] Wait 15 minutes for Apple's automated processing, then confirm the build appears under "TestFlight" in App Store Connect.

### Android — Upload key + AAB

- [ ] **Generate the upload keystore** (one-time, never again):

  ```bash
  cd apps/mobile/android
  keytool -genkey -v \
    -keystore signacare-sara-upload.jks \
    -keyalg RSA -keysize 4096 -validity 10000 \
    -alias upload \
    -dname "CN=Signacare PTY Ltd, O=Signacare, C=AU"
  ```

  Store both the .jks file AND the passwords in a password manager (1Password, Bitwarden, or an offline hardware vault). Losing the upload key is recoverable via Play App Signing key rotation; losing both keys is not.

- [ ] **Create `key.properties`** at `apps/mobile/android/key.properties`:

  ```
  storePassword=...
  keyPassword=...
  keyAlias=upload
  storeFile=/absolute/path/to/signacare-sara-upload.jks
  ```

  This file is in `.gitignore` and **must never be committed**. CI reads it from an encrypted GitHub secret at build time.

- [ ] Build the release Android App Bundle:

  ```bash
  cd apps/mobile
  flutter build appbundle --release
  # Output: build/app/outputs/bundle/release/app-release.aab
  ```

- [ ] Verify the AAB is signed with the correct key:

  ```bash
  keytool -printcert -jarfile build/app/outputs/bundle/release/app-release.aab
  ```

  The certificate fingerprint (SHA-256) should match the one Google Play Console shows under "App integrity → Upload key certificate".

- [ ] Upload the AAB to Play Console → **Internal testing** track first.

## 4. Review and rollout

### iOS

- [ ] Invite 10-20 beta testers via TestFlight. Use their email addresses from the Signacare clinician registry, not personal addresses.
- [ ] Collect feedback for at least 1 week.
- [ ] Submit for App Store review:
  - **Review notes** from STORE_LISTING.md §1 copied in verbatim.
  - **Demo account** credentials provided.
  - **First submission**: expect 1-3 business days for review.
  - **Rejection** most commonly happens for: missing demo account, misleading screenshots, PHI leaking in screenshots, missing microphone justification, or generic privacy policy text.
- [ ] On approval → **Manual release** (do NOT auto-release) so marketing can coordinate.
- [ ] **Phased release** (optional but recommended): 1% → 5% → 20% → 50% → 100% over 7 days. Pause at any stage if crash rate spikes in Sentry.

### Android

- [ ] Invite 10-20 internal testers via Play Console → Internal testing tab. Accept the test invite link on one real device before shipping wider.
- [ ] Promote the build to **Closed testing** for the design-partner cohort (1 week minimum).
- [ ] Promote to **Production** via **Staged rollout**:
  - 1% → 5% → 20% → 50% → 100%
  - Halt and roll back if ANR rate or crash-free users drops below 99%.
- [ ] Initial release targets **Australia only**. Expand to NZ, UK, Canada after 4 weeks of Australian production stability.

## 5. Post-launch

- [ ] Monitor Sentry dashboards for new crashes. Set an alert for "new crash group with >5 sessions affected" to the `#mobile-on-call` Slack.
- [ ] Monitor Play Console Vitals for ANR rate, crash rate, and excessive wakeups.
- [ ] Monitor App Store Connect for crashes (slower to surface than Sentry — 24-48h lag).
- [ ] Reply to every user review within 24 hours on business days. A clinician review complaining "cannot connect to server" is nearly always a clinic-server configuration issue; escalate to the clinic's ops contact.
- [ ] File follow-up tickets for any rejection reasons surfaced by Apple or Google — fix them before the next submission so the review cycle trends toward zero-round-trip approvals.

## 6. Compliance artefacts to keep on file

- [ ] Screenshot of the App Privacy / Data Safety disclosure at the time of submission.
- [ ] Screenshot of the signed privacy policy at the URL we declared.
- [ ] Copy of the release notes as submitted.
- [ ] Output of `keytool -printcert` for the upload key fingerprint.
- [ ] Copy of `pubspec.yaml` at the commit that built the release.
- [ ] Link to the CI run that built the release (the `azure-deploy.yml` workflow artefact for the backend + the Flutter build logs for the app).

All six items above live in `docs/mobile/sara-clinician/releases/<version>/` as the historical record of what was shipped, so a future audit or a TGA / DPA enquiry can be answered in minutes.

## 7. Escalation

If a release is blocked for >24 hours for any reason:

1. Post in `#mobile-on-call` with the blocker.
2. If App Store review rejected → open Apple Developer Contact Us → Resolution Centre, cite the rejection reason.
3. If Play Store rejected → Play Console → Policy → Appeal, cite the policy reference.
4. If a signing key is compromised or lost → start the Play App Signing key rotation workflow immediately (Apple key rotation is via Apple Support and takes 1-2 weeks).

---

*End of submission checklist. Keep this document updated as review requirements change — Apple and Google both tighten requirements every few months.*

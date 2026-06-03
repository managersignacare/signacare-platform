# Agent J — Mobile (Sara + Viva) audit (COMPLETED)

## CRITICAL findings

**[CRIT-J1]** Sara scribe — no pre-recording consent capture, no recording indicator (red dot / timer / badge), no `consentToRecording` field in notes, no audit trail. Matches Agent G CRIT-G1. Clinical/legal gap.

## HIGH findings

**[HIGH-J1]** **Bug 2 ROOT CAUSE — Viva activation error handling** (activate_screen.dart:40-59):
- Line 40,52-59: generic catch swallows specific backend errors → `_error = 'Activation failed. Please try again.'` masks "code expired" / "code invalid" from user
- Line 49: `_phone = result['phone'] as String?` unchecked — if backend omits phone, activation appears successful but `_phone = null`, UI breaks
- Line 46: `Map<String, dynamic>.from(data as Map)` unchecked cast crashes on non-Map JSON
**Root cause:** Fragile error parsing. Gold-standard fix: `on DioException catch (e) { _error = 'Activation failed: ${e.response?.data?['message'] ?? e.message}'; }` + validate phone non-null + type-check cast. Estimated 1hr.

**[HIGH-J2]** Error handling gaps — 8 sites with silent async failures:
- sync_service_native.dart:97-98 (flush pending writes silent failure)
- prescription_detail_screen.dart:85 (api.get('/staff/me') silent)
- contacts_tab.dart:211 (api.post('/contact-records') silent)
- vitals_screen.dart:709,713,782,790,888 (5× pApi.post('/patient-app/tracking') in EMPTY try/catch — **silent loss of patient-reported vitals**)
- appointments_screen.dart:48 (pApi.patch no feedback)
- rating_scales_screen.dart:201 (pApi.patch complete-assessment no feedback)

**[HIGH-J3]** Offline/sync write-side is weak:
- Viva vitals tracking has NO offline queue → all vitals lost permanently when offline
- Sara offline write queue may not survive uninstall/reinstall
- No conflict-resolution UI (two clinicians offline = last-write-wins silently)

**[HIGH-J4]** Sara scribe safety UI missing:
- No "Start Recording" button affordance
- No recording-state indicator
- No offline scribe queue (audio buffer) — data loss on network drop
- No manual-edit fallback if AI fails

## MEDIUM findings

**[MED-J1]** No field-level encryption for Sara MRN / pathology data at rest. SQLite encryption status unclear (SQLCipher not verified).

**[MED-J2]** Viva: phone stored plain text; no consent-to-contact flow before messaging; patient vitals sent without opt-in.

## PASS (no action)

- URL concat regressions: 0 (Bug 1 fix holds)
- Hardcoded URLs: 9 (all acceptable — dev defaults + crisis-resource URLs in wellness screen)
- Ghost API endpoints: 0 (15 sampled all resolve to backend routes)
- Auth token lifecycle: PASS (FlutterSecureStorage + 401 refresh interceptor + correct clearTokens on logout)

## Priority action items

1. Fix Viva activation error handling (Bug 2) — 1hr
2. Add offline write queue for Viva vitals — 4hr
3. Add Sara scribe pre-recording consent dialog — 2hr (also matches CRIT-G1)
4. Improve Sara sync flush error handling — 1hr
5. Field-level encryption (post-MVP) — 8hr

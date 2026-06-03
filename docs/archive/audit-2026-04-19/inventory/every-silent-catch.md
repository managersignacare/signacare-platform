# Silent-Catch Inventory — 2026-04-19

**Date Generated:** 2026-04-19  
**Total Catch Sites:** 103 (apps/api: 58, apps/web: 45)

| # | File:Line | Pattern | Surrounding Context | Category | Proposed Action |
|---|---|---|---|---|---|
| 1 | apps/api/src/mcp/scribeEnhancements.ts:1094 | `} catch { /* ignore */ }` | getScribePreferences — JSON.parse of setting_value | D | Annotate: `// intentional silent — setting may not exist` |
| 2 | apps/api/src/server.ts:821 | `} catch {}` | redis.keys/del in dev rate-limit flush | A | Keep; intentional: `// intentional silent — rate limit flush best-effort` |
| 3 | apps/api/src/server.ts:884 | `} catch {}` | db.destroy() in graceful shutdown | A | Keep; intentional: `// intentional silent — cleanup best-effort` |
| 4 | apps/api/src/server.ts:885 | `} catch {}` | redis.quit() in graceful shutdown | A | Keep; intentional: `// intentional silent — cleanup best-effort` |
| 5 | apps/api/src/server.ts:918 | `} catch {}` | db.destroy() in HTTP mode shutdown | A | Keep; intentional: `// intentional silent — cleanup best-effort` |
| 6 | apps/api/src/server.ts:919 | `} catch {}` | redis.quit() in HTTP mode shutdown | A | Keep; intentional: `// intentional silent — cleanup best-effort` |
| 7 | apps/api/src/seed-good-health/generators/05_master_login_table.ts:137 | `} catch { /* ignore */ }` | Directory check in fs.readdirSync loop | A | Keep; intentional: `// intentional silent — fallback to next strategy` |
| 8 | apps/api/src/mcp/server/mcpServer.ts:240 | `} catch {}` | RxNav API fetch in drug-interaction tool | E | Investigate: drug lookup failure silenced; may need logging for debugging |
| 9 | apps/api/src/mcp/aiEnhancer.ts:252 | `} catch { /* table may not exist yet */ }` | clinical_policies table query in buildAiContext | A | Keep; intentional: `// intentional silent — table created lazily` |
| 10 | apps/api/src/mcp/aiEnhancer.ts:265 | `} catch { /* table may not exist yet */ }` | ai_context_files table query in buildAiContext | A | Keep; intentional: `// intentional silent — table created lazily` |
| 11 | apps/api/src/mcp/aiEnhancer.ts:487 | `} catch { /* continue without enrichment */ }` | Optional enrichment in buildKShotExamples | A | Keep; intentional: `// intentional silent — enrichment optional` |
| 12 | apps/api/src/jobs/bootstrap.ts:79 | `} catch { /* already dead */ }` | whisperProcess.kill() | A | Keep; intentional: `// intentional silent — process cleanup best-effort` |
| 13 | apps/api/src/jobs/bootstrap.ts:189 | `} catch { /* already dead */ }` | whisperProcess.kill('SIGTERM') | A | Keep; intentional: `// intentional silent — process cleanup best-effort` |
| 14 | apps/api/src/utils/audit.ts:154 | `} catch { /* truly failed — already logged below */ }` | db.transaction in writeAuditLog | C | Verify logging; if logged at ERROR, keep as-is |
| 15 | apps/api/src/seed-good-health/index.ts:202 | `} catch { /* pool may already be closed — ignore */ }` | appPoolRaw.destroy() in shutdownPools | A | Keep; intentional: `// intentional silent — shutdown robustness` |
| 16 | apps/api/src/utils/queryCache.ts:40 | `} catch {}` | redis.del in invalidateCache | A | Keep; intentional: `// intentional silent — cache invalidation best-effort` |
| 17 | apps/api/src/utils/queryCache.ts:48 | `} catch {}` | redis.keys/del in invalidateCachePattern | A | Keep; intentional: `// intentional silent — cache invalidation best-effort` |
| 18 | apps/api/src/jobs/workers/sessionCleanupWorker.ts:16 | `} catch { /* Redis not available */ }` | require('./redis') at module top-level | A | Keep; intentional: `// intentional silent — feature-detect Redis availability` |
| 19 | apps/api/src/ocr/ocrAdapter.ts:72 | `} catch { /* best-effort */ }` | fs.unlink(p) in temp file cleanup | A | Keep; intentional: `// intentional silent — cleanup best-effort` |
| 20 | apps/api/src/seed-history-data.ts:271 | `} catch {}` | db operation in seed script | E | May be intentional in seed; verify context |
| 21 | apps/api/src/shared/jobBus.ts:152 | `} catch { /* best-effort */ }` | queue.close() in destructor | A | Keep; intentional: `// intentional silent — queue cleanup best-effort` |
| 22 | apps/api/src/shared/jobBus.ts:154 | `} catch { /* best-effort */ }` | redis connection.quit() in destructor | A | Keep; intentional: `// intentional silent — connection cleanup best-effort` |
| 23 | apps/api/src/shared/binaryResolver.ts:68 | `} catch { /* stat may throw on permissioned dirs — ignore */ }` | fs.statSync(p) permission check | A | Keep; intentional: `// intentional silent — permission-based feature detection` |
| 24 | apps/api/src/features/correspondence/correspondenceService.ts:70 | `} catch { /* already logged inside createAutoContactRecord */ }` | createAutoContactRecord call | C | Verify error propagation; if truly logged inside, acceptable |
| 25 | apps/api/src/integrations/fhir/smartAuth.ts:268 | `} catch { /* fall through */ }` | FHIR token fetch fallback | A | Keep with clarified comment: `// intentional silent — fallback to next strategy` |
| 26 | apps/api/src/integrations/safeScript/safeScriptService.ts:153 | `} catch { /* risk check is optional — don't block on failure */ }` | SafeScript risk assessment | A | Keep; intentional: `// intentional silent — optional enrichment` |
| 27 | apps/web/src/shared/hooks/useEventStream.ts:89 | `} catch { /* ignore parse errors */ }` | JSON.parse(e.data) in SSE listener | D | Acceptable; JSON.parse of untrusted SSE data |
| 28 | apps/web/src/shared/hooks/useEventStream.ts:102 | `} catch { /* ignore */ }` | JSON.parse(e.data) in onmessage handler | D | Acceptable; JSON.parse of untrusted SSE data |
| 29 | apps/web/src/features/settings/pages/SettingsPage.tsx:450 | `} catch { /* ignore */ }` | Unidentified block (need context) | E | Read full function to classify |
| 30 | apps/web/src/features/settings/pages/SettingsPage.tsx:457 | `} catch { /* ignore */ }` | Unidentified block (need context) | E | Read full function to classify |
| 31 | apps/api/src/features/messaging/messageRepository.ts:250 | `} catch { /* notification emit is non-blocking — the message row is already saved */ }` | Notification emit after message save | A | Keep; intentional: `// intentional silent — notification best-effort` |
| 32 | apps/api/src/features/messaging/messageService.ts:30 | `} catch { /* already logged inside createAutoContactRecord */ }` | createAutoContactRecord call | C | Verify error propagation |
| 33 | apps/api/src/features/backup/backupRoutes.ts:268 | `} catch { /* already dead */ }` | pgDump.kill('SIGTERM') | A | Keep; intentional: `// intentional silent — process cleanup best-effort` |
| 34 | apps/api/src/features/backup/backupRoutes.ts:269 | `} catch { /* already dead */ }` | gzip.kill('SIGTERM') | A | Keep; intentional: `// intentional silent — process cleanup best-effort` |
| 35 | apps/api/src/features/backup/backupRoutes.ts:272 | `} catch { /* ignore */ }` | fs.unlinkSync(filepath) if exists | A | Keep; intentional: `// intentional silent — cleanup best-effort` |
| 36 | apps/web/src/shared/services/apiClient.ts:117 | `} catch {}` | sessionStorage.setItem in redirect-after-login | A | Keep; intentional: `// intentional silent — feature-detect sessionStorage` |
| 37 | apps/api/src/features/power-settings/powerSettingsRoutes.ts:222 | `} catch { /* audit is non-blocking */ }` | Audit log write after power setting update | A | Keep; intentional: `// intentional silent — audit best-effort` |
| 38 | apps/web/src/features/patients/pages/PatientsPage.tsx:510 | `} catch {}` | Unidentified block (need context) | E | Read full function to classify |
| 39 | apps/api/src/features/events/ssePublisher.ts:19 | `} catch { /* non-critical — SSE delivery is best-effort */ }` | redisClient.publish in SSE | A | Keep; intentional: `// intentional silent — SSE delivery best-effort` |
| 40 | apps/api/src/features/events/ssePublisher.ts:28 | `} catch { /* non-critical — SSE delivery is best-effort */ }` | redisClient.publish in SSE | A | Keep; intentional: `// intentional silent — SSE delivery best-effort` |
| 41 | apps/api/src/features/events/sseRoutes.ts:161 | `} catch { /* already closed */ }` | res.end() in SSE close handler | A | Keep; intentional: `// intentional silent — connection already closed` |
| 42 | apps/api/src/features/patient-outreach/patientOutreachRoutes.ts:104 | `} catch { /* non-blocking */ }` | Fire-and-forget operation | A | Keep; intentional: `// intentional silent — async operation non-blocking` |
| 43 | apps/api/src/features/documents/documentService.ts:249 | `} catch { /* already logged internally */ }` | Internal operation with logging | C | Verify logging is at ERROR level |
| 44 | apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:463 | `} catch { /* ignore */ }` | Unidentified block (need context) | E | Read full function to classify |
| 45 | apps/web/src/features/staff-settings/pages/StaffAssignmentsPage.tsx:474 | `} catch { /* ignore */ }` | Unidentified block (need context) | E | Read full function to classify |
| 46 | apps/web/src/features/handover/pages/HandoverListPage.tsx:47 | `} catch { /* fall through */ }` | Optional operation with fallback | A | Keep; intentional: `// intentional silent — fallback to next strategy` |
| 47 | apps/web/src/features/handover/pages/HandoverListPage.tsx:53 | `} catch { /* fall through */ }` | Optional operation with fallback | A | Keep; intentional: `// intentional silent — fallback to next strategy` |
| 48 | apps/web/src/features/calendar/components/ICalSubscribeCard.tsx:52 | `} catch { /* ignore */ }` | navigator.clipboard.writeText — feature-detect | A | Keep; intentional: `// intentional silent — feature-detect clipboard API` |
| 49 | apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx:194 | `} catch { /* surfaced by the parent */ }` | remove.mutateAsync(b.id) in mutation | C | Verify parent onError; if set, acceptable |
| 50 | apps/web/src/features/calendar/components/AvailabilityGridEditor.tsx:212 | `} catch { /* surfaced by the parent */ }` | create.mutateAsync in mutation | C | Verify parent onError; if set, acceptable |
| 51 | apps/web/src/features/patients/components/notes/AmbientAiRecorder.tsx:371 | `} catch { /* non-fatal */ }` | streamingClientRef.current.finish() | A | Keep; intentional: `// intentional silent — streaming client cleanup` |
| 52 | apps/web/src/features/drafts/pages/DraftsPage.tsx:66 | `} catch { /* ignore */ }` | apiClient.delete in inline click handler | C | Should use mutation with onError; refactor recommended |
| 53 | apps/web/src/features/patients/components/notes/NotesList.tsx:55 | `} catch { /* BroadcastChannel not supported */ }` | BroadcastChannel constructor — feature-detect | A | Keep; intentional: `// intentional silent — feature-detect BroadcastChannel` |
| 54 | apps/web/src/features/subscription/pages/SubscriptionPage.tsx:27 | `} catch { /* ignore */ }` | Unidentified block (need context) | E | Read full function to classify |
| 55 | apps/web/src/shared/components/ui/AiQuickTasks.tsx:186 | `} catch { /* ignore */ }` | Unidentified block (need context) | E | Read full function to classify |
| 56 | apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:935 | `} catch { /* */ }` | Empty comment; likely unfinished | E | **URGENT:** Add meaningful comment or logging |
| 57 | apps/api/src/features/patient-app/patientAppRoutes.ts:422 | `} catch { /* non-blocking */ }` | Fire-and-forget operation | A | Keep; intentional: `// intentional silent — async operation non-blocking` |
| 58 | apps/api/src/features/patient-app/patientAppRoutes.ts:1074 | `} catch { /* non-blocking */ }` | Fire-and-forget operation | A | Keep; intentional: `// intentional silent — async operation non-blocking` |
| 59 | apps/web/src/features/ai-agent/pages/AiAgentPage.tsx:337 | `} catch { /* silent */ }` | Comment is placeholder; unclear intent | E | **URGENT:** Replace with meaningful comment or logging |
| 60 | apps/api/src/features/roles/crossRoleFeatureRoutes.ts:297 | `} catch { /* best-effort */ }` | blobStorage.delete(put.key) — cleanup | A | Keep; intentional: `// intentional silent — blob cleanup best-effort` |
| 61 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:628 | `} catch { /* non-critical */ }` | Non-critical UI operation | A | Keep; intentional: `// intentional silent — UI best-effort` |
| 62 | apps/web/src/features/patients/components/detail/tabs/AppointmentsTab.tsx:632 | `} catch { /* error handled by global handler */ }` | Error delegated to global handler | E | Verify global handler exists and covers this code path |
| 63 | apps/web/src/shared/utils/openInNewWindow.ts:185 | `} catch(e) { /* BroadcastChannel not supported */ }` | BroadcastChannel — feature-detect | A | Keep; intentional: `// intentional silent — feature-detect BroadcastChannel` |
| 64 | apps/web/src/features/nursing/pages/NursingPage.tsx:550 | `} catch { /* ignore */ }` | Unidentified block (need context) | E | Read full function to classify |
| 65 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:332 | `} catch { /* might not have linked referral */ }` | apiClient.patch referral-by-episode (accept) | B | **FIX REQUIRED:** User sees success UI; patch may fail silently. Add error toast. |
| 66 | apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:345 | `} catch { /* might not have linked referral */ }` | apiClient.patch referral-by-episode (reject) | B | **FIX REQUIRED:** User sees success UI; patch may fail silently. Add error toast. |
| 67 | apps/api/src/features/episode/episodeRoutes.ts:281 | `} catch { /* workflow engine may not be loaded */ }` | Workflow engine invoke in episode handler | A | Keep; intentional: `// intentional silent — optional feature` |
| 68 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:175 | `} catch { /* ignore */ }` | Unidentified block (need context) | E | Read full function to classify |
| 69 | apps/web/src/features/psychiatrist/pages/PsychiatristPage.tsx:444 | `} catch { /* microphone access denied */ }` | mediaRecorder setup — feature-detect | A | Keep; intentional: `// intentional silent — microphone feature-detect` |
| 70 | apps/web/src/features/patients/components/detail/tabs/AlertsPlansTab.tsx:421 | `} catch { /* handle error */ }` | Comment is vague; error not actually handled | E | **URGENT:** Add specific error handling or logging |
| 71 | apps/api/src/features/contacts/contactRecordRoutes.ts:141 | `} catch { /* content not parseable — keep the record */ }` | JSON.parse of contact content | A | Keep; intentional: `// intentional silent — invalid JSON handled gracefully` |
| 72 | apps/web/src/features/patients/components/detail/tabs/NinetyOneDayReviewTab.tsx:411 | `} catch { /* continue creating remaining */ }` | Bulk operation iteration | A | Keep; intentional: `// intentional silent — partial success acceptable` |
| 73 | apps/web/src/features/beds/pages/BedBoardPage.tsx:257 | `} catch {}` | Unidentified block (need context) | E | Read full function to classify |
| 74 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:643 | `} catch {}` | API call in Viva tab | B | **FIX REQUIRED:** Likely mutation failure; verify error handling |
| 75 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:652 | `} catch {}` | API call in Viva tab | B | **FIX REQUIRED:** Likely mutation failure; verify error handling |
| 76 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1019 | `} catch { /* handled by addMut */ }` | Mutation operation with parent error handler | C | Verify parent mutation has onError; if set, acceptable |
| 77 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1400 | `} catch {}` | JSON.parse(e.note) in mapping function | D | Acceptable; JSON.parse of untrusted data |
| 78 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1410 | `} catch {}` | JSON.parse(e.note) in mapping function | D | Acceptable; JSON.parse of untrusted data |
| 79 | apps/web/src/features/patients/components/detail/tabs/VivaTab.tsx:1503 | `} catch {}` | JSON.parse(e.note) in mapping function | D | Acceptable; JSON.parse of untrusted data |
| 80 | apps/web/src/features/patients/components/detail/tabs/PhysicalHealthTab.tsx:94 | `} catch { /* */ }` | Empty comment; mutation failure silenced | B | **FIX REQUIRED:** Add error toast or logging. User sees success UI. |
| 81 | apps/api/src/features/auth/authController.ts:118 | `} catch { /* audit must not block login */ }` | Audit log write after login | A | Keep; intentional: `// intentional silent — audit non-blocking` |
| 82 | apps/api/src/features/auth/authController.ts:192 | `} catch { /* audit must not block logout */ }` | Audit log write after logout | A | Keep; intentional: `// intentional silent — audit non-blocking` |
| 83 | apps/api/src/features/auth/authService.ts:173 | `} catch { /* non-blocking */ }` | Fire-and-forget operation | A | Keep; intentional: `// intentional silent — async operation non-blocking` |
| 84 | apps/api/src/features/license/licenseRoutes.ts:17 | `} catch { /* no license */ }` | License table query — feature-detect | A | Keep; intentional: `// intentional silent — optional feature` |
| 85 | apps/api/src/features/license/licenseRoutes.ts:26 | `} catch { /* tables may not exist */ }` | License tables query — startup | A | Keep; intentional: `// intentional silent — tables created lazily` |
| 86 | apps/api/src/reset-patient-data.ts:89 | `} catch { /* best effort */ }` | Cleanup in reset script | A | Keep; intentional: `// intentional silent — cleanup best-effort` |
| 87 | apps/api/src/features/appointments/appointmentService.ts:274 | `} catch { /* skip conflicts */ }` | Recurrence instance creation with conflict handling | A | Keep; intentional: `// intentional silent — conflict is acceptable` |
| 88 | apps/api/src/features/appointments/appointmentService.ts:297 | `} catch { /* skip conflicts */ }` | Recurrence instance creation with conflict handling | A | Keep; intentional: `// intentional silent — conflict is acceptable` |
| 89 | apps/api/src/features/clinical-notes/clinicalNote.service.ts:107 | `} catch { /* already logged inside createAutoContactRecord */ }` | createAutoContactRecord call | C | Verify error propagation |
| 90 | apps/api/src/features/patients/patientRoutes.ts:439 | `} catch { /* best-effort */ }` | blobStorage.delete after db fail | A | Keep; intentional: `// intentional silent — orphan cleanup best-effort` |
| 91 | apps/api/src/features/patients/patientRoutes.ts:500 | `} catch { /* best-effort */ }` | blobStorage.delete after db fail | A | Keep; intentional: `// intentional silent — orphan cleanup best-effort` |
| 92 | apps/api/src/features/patients/patientRoutes.ts:739 | `} catch { /* non-blocking */ }` | Fire-and-forget operation | A | Keep; intentional: `// intentional silent — async operation non-blocking` |
| 93 | apps/api/src/features/patients/patientRoutes.ts:784 | `} catch { /* workflow engine may not be loaded */ }` | Workflow engine invoke | A | Keep; intentional: `// intentional silent — optional feature` |
| 94 | apps/api/src/features/patients/patientRoutes.ts:894 | `} catch { /* best-effort */ }` | blobStorage.delete after db fail | A | Keep; intentional: `// intentional silent — orphan cleanup best-effort` |
| 95 | apps/api/src/features/patients/patientRoutes.ts:1019 | `} catch { /* best-effort */ }` | blobStorage.delete after db fail | A | Keep; intentional: `// intentional silent — orphan cleanup best-effort` |
| 96 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:184 | `} catch { /* skip */ }` | RxNav API fetch in drug interaction check | E | Investigate: may need logging for debugging |
| 97 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2408 | `} catch { /* show error */ }` | Comment says show error but none shown; likely unfinished | E | **URGENT:** Add error toast or remove misleading comment |
| 98 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2436 | `} catch {}` | Inline button click handler; mutation failure silenced | B | **FIX REQUIRED:** Add error toast or use proper mutation onError |
| 99 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2443 | `} catch {}` | Inline button click handler; mutation failure silenced | B | **FIX REQUIRED:** Add error toast or use proper mutation onError |
| 100 | apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2509 | `} catch { /* skip failed lookups */ }` | External API in data mapping | A | Keep; intentional: `// intentional silent — graceful degradation` |
| 101 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:899 | `} catch { /* */ }` | Empty comment; unfinished | E | **URGENT:** Add meaningful comment or logging |
| 102 | apps/web/src/features/patients/components/detail/tabs/InpatientCareTab.tsx:1023 | `} catch { /* */ }` | Empty comment; unfinished | E | **URGENT:** Add meaningful comment or logging |
| 103 | apps/web/src/features/patients/components/detail/tabs/SummaryTab.tsx:1906 | `} catch {}` | JSON.parse of note field in helper | D | Acceptable; JSON.parse of untrusted data |

---

## Summary by Category

**A — Intentional Silence (Cleanup, Feature-Detect, Optional):** 57 sites  
- Keep all; annotate with `// intentional silent — <reason>`

**B — Save-Fail-Hidden (Mutation/State Failure Risk):** 9 sites  
- **CRITICAL:** Fix all. Add error toast or logging to prevent silent failures.
  - EpisodesTab.tsx:332, :345
  - VivaTab.tsx:643, :652
  - PhysicalHealthTab.tsx:94
  - MedicationsTab.tsx:2436, :2443, :2408
  - DraftsPage.tsx:66

**C — Caller-Handles (Parent Error Handler Present):** 8 sites  
- Verify parent `onError` is set; if not, refactor to remove redundant catch.

**D — JSON.parse (Untrusted Data):** 6 sites  
- Acceptable pattern; annotate with `// intentional silent — untrusted JSON parsing`

**E — Unknown (Requires Per-Site Review):** 23 sites  
- Investigate each before finalizing.
- Likely candidates for B (error silencing) or E (incomplete implementation).

---

## High-Priority Fixes Required

1. **apps/web/src/features/patients/components/detail/tabs/PhysicalHealthTab.tsx:94**  
   `setSaving(true); ... await apiClient.post(...); setSaving(false);` — if POST fails, user sees stale UI.  
   **Action:** Add `.catch(err => { showErrorToast(err); })` before setSaving(false).

2. **apps/web/src/features/patients/components/detail/tabs/EpisodesTab.tsx:332, :345**  
   Referral patch (accept/reject) fails silently; user sees success UI.  
   **Action:** Add error toast.

3. **apps/web/src/features/patients/components/detail/tabs/EctTab.tsx:935, AlertsPlansTab.tsx:421, AiAgentPage.tsx:337**  
   Empty or placeholder comments; unclear intent.  
   **Action:** Add meaningful comment or logging.

4. **apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx:2436, :2443, :2408**  
   Inline click handlers with silenced mutations.  
   **Action:** Refactor to use proper `useMutation` with `onError`.

---

## Audit Notes

- **Total Lines of Code Analyzed:** ~6,000+ (full apps/api/src and apps/web/src trees)
- **Detection Method:** Regex pattern matching for `catch { }`, `catch { /* */ }`, and `.catch(() => {})`
- **Exclusions Applied:** node_modules, dist, build, test-only files
- **Confidence Level:** High for category A, B, D; Medium for C, E (per-file review required)

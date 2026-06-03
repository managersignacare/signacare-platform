# BUG-272 — WebSocket scribe recording consent gate (mirror of BUG-035)

**Metadata**

- Severity: **S0** (patient safety / privacy — OAIC Privacy APP 3.1 + NDB scheme; AHPRA + Vic MHA 2014 clinician-patient confidentiality).
- Track / Wave: **A / A-2**.
- State: fixed (this commit).
- Fix-registry anchor: `R-FIX-SCRIBE-WEBSOCKET-CONSENT-GATE`.
- Mirrors: BUG-035 (HTTP `/ambient-note` consent + relationship gate, commit `aba14df`).

---

## Diagnosis

[apps/api/src/mcp/scribeStreaming.ts](apps/api/src/mcp/scribeStreaming.ts) at path `/ws/scribe` accepts **any** WebSocket upgrade with no auth, then — on the client's first `{type:'start'}` message — extracts `staffId` and `clinicId` **from the client message** (line 191-192) with zero validation, creates a session, and feeds audio chunks to Whisper + `processAmbientAudio`. No consent gate, no patient-relationship gate, no audit trail.

Attack scenario: clinician A (clinic X) opens `/ws/scribe` with any JWT (or none), sends `{type:'start', staffId: <own>, clinicId: <own>, patientId: <Patient B in clinic Y>}`. Audio captured, Whisper runs, LLM runs. Clinic Y has no awareness. Patient B's privacy breached. Though the current WS handler does **not** persist to `clinical_notes`, (a) `processAmbientAudio` still runs against unconsented audio, and (b) any future PR wiring persistence would silently enable the full attack because no gate exists to remove.

This is the exact leak class BUG-035 closed on the HTTP surface. The WebSocket path was left unprotected.

## Fix — two gates + state machine + timeout

### Gate 1: upgrade-time authentication

Intercept `server.on('upgrade')` BEFORE calling `wss.handleUpgrade()`. Mirrors the Express `authMiddleware` primitives from [authMiddleware.ts:17-29](apps/api/src/middleware/authMiddleware.ts#L17-L29):

1. Parse `Authorization: Bearer <jwt>` header OR `signacare_access` cookie from the HTTP upgrade request.
2. `jwt.verify(token, config.jwt.accessSecret)`.
3. Build an `AuthContext`-equivalent from the payload (`staffId`, `clinicId`, `role`, etc.).
4. Attach to the upgrade request (`request.auth = ctx`) so the `connection` event can read it.
5. On any failure: write `HTTP/1.1 401 Unauthorized\r\n\r\n` to the raw socket and `socket.destroy()`. WebSocket handshake never completes.

This is explicit-over-implicit (chose `server.on('upgrade')` over `wss.verifyClient` per reviewer consensus: testability + standard HTTP 401 before protocol engages + future extensibility).

### Gate 2: session-open consent + relationship

State machine per connection:

```
PENDING_START  →  ACTIVE  →  STOPPED
      |              |          |
      v              v          v
  (audio frames   (audio        (WS closes
   dropped)       accepted,     normally on stop
                  processed)    or error)

  [5s idle in PENDING_START → close 4408]
```

- **PENDING_START** — invariant: **no audio frame in this state ever reaches Whisper or the LLM pipeline.** Binary frames received here are dropped silently at the frame handler. No Whisper instance is pre-warmed, so no teardown is needed on gate-2 failure (design-level, not runtime-check).
- On `{type:'start', patientId, consentId}` message:
  1. Zod-validate schema. Failure → close `4422 INVALID_SESSION_OPEN`.
  2. `requirePatientRelationship(auth, patientId)`. Failure → close `4403 NO_PATIENT_RELATIONSHIP`.
  3. `verifyRecordingConsent(auth.clinicId, patientId, consentId)`. Failure → close `4403 CONSENT_REQUIRED` or `4403 CONSENT_EXPIRED`.
  4. `writeAuditLog({ action: 'AMBIENT_NOTE_RECORDING_STARTED', recordId: consentId, newData: { patientId, transport: 'websocket' } })`.
  5. Transition to ACTIVE; send `{type:'session_started', sessionId}`.
- **ACTIVE** — existing audio accumulation + partial-transcript + stop-triggered full pipeline logic unchanged.
- **STOPPED** — normal close or error.
- **Second `start` while ACTIVE** → close `4409 SESSION_ALREADY_OPEN`.
- **PENDING_START timeout (5s default, `SCRIBE_WS_SESSION_OPEN_TIMEOUT_MS`)** — if the client opens a WS and never sends `start` (or sends anything else), close `4408 SESSION_OPEN_TIMEOUT`. Prevents lingering unauth'd (well, auth'd but non-actionable) sockets from consuming server memory.

**Critical security property (absorbed from pre-exec reviews): client-supplied `staffId` / `clinicId` in the start message are IGNORED.** Session `staffId` + `clinicId` come from `request.auth` (upgrade-time auth), not from any client-controlled field. Closes the BUG-035 spoofing vector on the WS surface.

### Close-code enum (new)

Named constants block at module top for operator + reviewer clarity (absorbed from Review 2 — prevents "undocumented folklore" drift):

```ts
export const SCRIBE_WS_CLOSE = {
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,              // NO_PATIENT_RELATIONSHIP / CONSENT_REQUIRED / CONSENT_EXPIRED
  SESSION_OPEN_TIMEOUT: 4408,
  SESSION_ALREADY_OPEN: 4409,
  INVALID_SESSION_OPEN: 4422,
  NORMAL: 1000,
} as const;
```

Codes chosen in the 4000-4999 app-specific RFC 6455 range, mirroring HTTP status for cross-layer observability.

## Defence in depth

| Layer | What | Owner |
|---|---|---|
| 1 | Upgrade-time JWT verification | `onUpgrade` handler (new) |
| 2 | Per-session consent + relationship | `handleStart()` (new) |
| 3 | Zod schema validation on start message | inline (new) |
| 4 | Audit trail (AMBIENT_NOTE_RECORDING_STARTED with transport:'websocket') | `writeAuditLog` (reused) |
| 5 | State-machine invariant: no audio in PENDING_START | frame handler branch (new) |

Each layer runs independently; no layer trusts another. A bug in one does not collapse the others.

## Reused primitives (no duplication)

| Primitive | Location | Usage |
|---|---|---|
| `verifyRecordingConsent(clinicId, patientId, consentId)` | [shared/recordingConsent.ts:52-82](apps/api/src/shared/recordingConsent.ts#L52-L82) | called verbatim — designed for this mirror. |
| `requirePatientRelationship(auth, patientId)` | [shared/authGuards.ts:127-185](apps/api/src/shared/authGuards.ts#L127-L185) | called verbatim. |
| `writeAuditLog({ action: 'AMBIENT_NOTE_RECORDING_STARTED', … })` | [utils/audit.ts:36](apps/api/src/utils/audit.ts#L36) (enum), [llmRoutes.ts:565-572](apps/api/src/features/llm/llmRoutes.ts#L565-L572) (call pattern) | mirror the call with `transport: 'websocket'` in `newData`. |
| JWT verify + cookie/Bearer parse | [middleware/authMiddleware.ts:17-29](apps/api/src/middleware/authMiddleware.ts#L17-L29) | inlined at upgrade (can't use Express middleware on raw HTTP upgrade). |

## Tests — 8 integration tests, red-first

[apps/api/tests/integration/scribeWebSocketConsent.int.test.ts](apps/api/tests/integration/scribeWebSocketConsent.int.test.ts) — template mirrored from [ambientNoteConsentGate.int.test.ts](apps/api/tests/integration/ambientNoteConsentGate.int.test.ts).

| # | Scenario | Expected |
|---|---|---|
| W1 | Upgrade without `Authorization` header | HTTP 401 on upgrade; WS never opens |
| W2 | Upgrade with invalid JWT | HTTP 401 |
| W3 | Open WS, send malformed `{type:'start'}` missing patientId / consentId | Close `4422 INVALID_SESSION_OPEN` |
| W4 | Open WS, start with consentId that doesn't exist | Close `4403 CONSENT_REQUIRED`; no audit row |
| W5 | Open WS, start with stale consent (>60 min) | Close `4403 CONSENT_EXPIRED`; no audit row |
| W6 | Open WS (as clinician with NO patient relationship) | Close `4403 NO_PATIENT_RELATIONSHIP`; no audit row |
| W7 | Happy path — valid consent + relationship → `{type:'session_started'}`; audit_log row present bound to consentId with transport:'websocket' | Passes |
| W8 | Open WS (auth valid), send NO start within 5s | Close `4408 SESSION_OPEN_TIMEOUT` |

**Red-first:** W1-W6 + W8 fail pre-fix. W7 partially passes (ack happens) but the audit-log assertion fails. Post-fix: **8/8 PASS**.

## Non-goals

- Do NOT touch Whisper + LLM pipeline (`processAmbientAudio`) — unchanged, now gated.
- Do NOT wire DB persistence — not wired today; not enabled by this fix. Gate is in place for the day someone does.
- Do NOT re-verify consent per-frame — once ACTIVE with valid consent, no per-frame re-check (consent TTL covers a recording session).
- Do NOT change HTTP `/ambient-note` (BUG-035's territory).
- Do NOT audit non-scribe WebSockets (presence / collab / alerts, if any).
- Do NOT implement Ping/Pong heartbeats in this PR — filed as **BUG-314 (S3 B-11)** follow-up.

## Reviewer refinement trail (pre-execution)

Two external critique reviews. Both confirmed the two tactical calls and added 3 substantive items + 2 clarifications. No fabrications.

| Item | Source | Action |
|---|---|---|
| PENDING_START 5s idle timeout → 4408 | R1 | State machine + test W8 added |
| "No audio in PENDING_START reaches Whisper" invariant — document | R2 | Added to Gate 2 description |
| Close-code named enum block at module top | R2 | `SCRIBE_WS_CLOSE` constants |
| Whisper cleanup on gate-2 failure | R1 | Verified not needed: design drops frames in PENDING_START so no Whisper instance exists at failure |
| Ping/Pong heartbeats | R1 | Scope-limited out → BUG-314 (S3 B-11) |

## QA verdicts

- **L3 code-reviewer-general:** TBD (runs in parallel with L4 + L5)
- **L4 clinical-safety-reviewer:** TBD
- **L5 architecture-reviewer:** TBD

## Residual risk

- **Browser-side recording before WS opens** — `MediaRecorder` captures audio during handshake. Backend can only gate what reaches the server; browser-side consent UX is frontend scope.
- **Session hijack after upgrade** — JWT valid at upgrade but revoked mid-session: WS stays open. Mirrors HTTP session model; same residual BUG-035 accepts.
- **Per-clinic TTL drift** — `SCRIBE_CONSENT_TTL_MINUTES` is process-global. Tracked by **BUG-310 (S2 B-11)**.
- **Dead-client detection** — no Ping/Pong today. Tracked by **BUG-314 (S3 B-11)**.
- **Novel WebSocket subprotocols** — if a future feature adds a second WS endpoint handling PHI (presence, alerts, etc.), this fix covers only `/ws/scribe`. A future WS surface audit would catch any new endpoint.

## Fix-registry row

`R-FIX-SCRIBE-WEBSOCKET-CONSENT-GATE` — `apps/api/src/mcp/scribeStreaming.ts` — `present` — `verifyRecordingConsent\(`.

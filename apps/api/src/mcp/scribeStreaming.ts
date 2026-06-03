/**
 * Real-time streaming scribe WS flow with two gates:
 * 1) upgrade JWT auth, 2) patient-relationship + consent check on start.
 * BUG-272 hardened this surface to reject unsafe/bypassed recording starts.
 */

import { Server as HttpServer, IncomingMessage } from 'http';
import { Socket } from 'net';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import axios from 'axios';
import { z } from 'zod';
import type { AuthContext } from '@signacare/shared';
import { logger } from '../utils/logger';
import { config } from '../config';
import { verifyAccessToken, type AccessTokenPayload } from '../utils/authTokens';

// keep `config` import for whisper/ollama URL usage symmetry.
void config;
import { verifyRecordingConsent, isConsentRevoked } from '../shared/recordingConsent';
import { requirePatientRelationship } from '../shared/authGuards';
import { isUserRevokedAfter } from '../middleware/jwtBlacklist';
import { writeAuditLog } from '../utils/audit';
// WS upgrades bypass Express middleware, so we must set clinic context explicitly.
import { withTenantContext } from '../shared/tenantContext';
import { registerShutdownHook } from '../shared/gracefulShutdown';
import { ScribeWebSocketHeartbeatController } from './scribeWebSocketHeartbeat';

// ws is optional — streaming only works if installed (npm i ws @types/ws)
interface ScribeWebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: 'message', listener: (data: Buffer | string) => void): void;
  on(event: 'close', listener: () => void): void;
  on(event: 'error', listener: (err: Error) => void): void;
  on(event: 'pong', listener: () => void): void;
}

interface ScribeWebSocketServerLike {
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer, cb: (ws: ScribeWebSocketLike) => void): void;
  emit(event: 'connection', ws: ScribeWebSocketLike, req: IncomingMessage): boolean;
  on(event: 'close', listener: () => void): this;
  on(event: 'connection', listener: (ws: ScribeWebSocketLike) => void): this;
  close(cb: () => void): void;
  clients?: Iterable<ScribeWebSocketLike>;
}

type ScribeWebSocketWithAuth = ScribeWebSocketLike & { _scribeAuth: AuthContext };

const WHISPER_API_URL = process.env.WHISPER_API_URL ?? 'http://localhost:8080';

/** RFC6455 app-specific close codes aligned to equivalent HTTP semantics. */
export const SCRIBE_WS_CLOSE = {
  /** JWT missing or invalid at upgrade (never reached — upgrade returns HTTP 401). */
  UNAUTHORIZED: 4401,
  /** Gate 2 failure: NO_PATIENT_RELATIONSHIP / CONSENT_REQUIRED / CONSENT_EXPIRED. */
  FORBIDDEN: 4403,
  // BUG-274: consent revoked mid-session; reason string distinguishes from generic FORBIDDEN.
  RECORDING_REVOKED: 4403,
  /** Client opened a socket but never sent {type:'start'} within the idle window. */
  SESSION_OPEN_TIMEOUT: 4408,
  /** Client sent a second {type:'start'} on an already-ACTIVE session. */
  SESSION_ALREADY_OPEN: 4409,
  /** Server heartbeat timed out (dead client / half-open socket). */
  HEARTBEAT_TIMEOUT: 4410,
  /** First message failed Zod validation (missing patientId / consentId). */
  INVALID_SESSION_OPEN: 4422,
  /** Normal close (WS spec — not app-specific). */
  NORMAL: 1000,
} as const;

/** Max time a new socket can stay open before sending `{type:'start'}`. */
export const SCRIBE_WS_SESSION_OPEN_TIMEOUT_MS =
  parseInt(process.env.SCRIBE_WS_SESSION_OPEN_TIMEOUT_MS ?? '10000', 10) || 10000;

const SCRIBE_WS_HEARTBEAT_INTERVAL_MS =
  parseInt(process.env.SCRIBE_WS_HEARTBEAT_INTERVAL_MS ?? '15000', 10) || 15000;
const SCRIBE_WS_HEARTBEAT_TIMEOUT_MS =
  parseInt(process.env.SCRIBE_WS_HEARTBEAT_TIMEOUT_MS ?? '45000', 10) || 45000;

type SessionState = 'PENDING_START' | 'ACTIVE' | 'STOPPED';

interface StreamingSession {
  id: string;
  staffId: string;
  clinicId: string;
  state: SessionState;
  chunks: Buffer[];
  partialTranscript: string;
  lastChunkTime: number;
  format: string;
  specialty: string;
  patientId?: string;
  /**
   * BUG-274 — scribe_consents.id bound at session-open. Every chunk
   * ingestion path re-reads this consent's `revoked_at` (cached) and
   * halts the session if the patient revoked mid-session.
   */
  consentId: string;
  processing: boolean;
}

const sessions = new Map<string, StreamingSession>();

const StartMessageSchema = z.object({
  type: z.literal('start'),
  patientId: z.string().uuid(),
  consentId: z.string().uuid(),
  format: z.string().optional(),
  specialty: z.string().optional(),
});

/** Prefer cookie auth, then Authorization bearer token on WS upgrade. */
function extractTokenFromUpgrade(req: IncomingMessage): string | null {
  const cookieHeader = req.headers['cookie'];
  if (typeof cookieHeader === 'string') {
    for (const part of cookieHeader.split(';')) {
      const [k, v] = part.trim().split('=');
      if (k === 'signacare_access' && v) return decodeURIComponent(v);
    }
  }
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}

/** Build AuthContext from verified JWT payload in WS (no Express req object). */
function buildAuthFromJwtPayload(payload: AccessTokenPayload): AuthContext {
  return {
    staffId: payload.id,
    clinicId: payload.clinicId,
    role: payload.role,
    // patient_app variant has no `permissions`; flatten to [].
    permissions: 'permissions' in payload ? payload.permissions : [],
    patientId: undefined,
    requestId: undefined,
    breakGlassSessionId:
      payload.kind === 'staff_break_glass' ? payload.breakGlassSessionId : undefined,
  };
}

/** Gate 1: verify JWT at upgrade; hard-close on failure before WS handshake. */
async function authenticateUpgrade(req: IncomingMessage, socket: Socket): Promise<AuthContext | null> {
  const token = extractTokenFromUpgrade(req);
  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
  try {
    const payload = verifyAccessToken(token);
    // BUG-356 L4 Rule 2/3 absorb — scribe WS is an AI clinical-data
    // surface. Without this check, a demoted clinician keeps streaming
    // audio into patient records for up to 60 min (JWT access TTL). The
    // blacklist check is the same Layer A control applied at the REST
    // authMiddleware. Fails-open on Redis error with logger.warn — do
    // not block upgrades if Redis blinks; the JWT exp claim still
    // enforces the hard lifetime.
    let revoked = false;
    try {
      revoked = await isUserRevokedAfter(payload.id, payload.iat);
    } catch (err) {
      logger.warn(
        { err, staffId: payload.id, kind: 'jwt_blacklist_fail_open', surface: 'scribe_ws' },
        'BUG-356: scribe WS isUserRevokedAfter check failed — failing open',
      );
    }
    if (revoked) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return null;
    }
    return buildAuthFromJwtPayload(payload);
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return null;
  }
}

export async function setupScribeWebSocket(server: HttpServer): Promise<void> {
  let WebSocketServer: ((options: { noServer: boolean }) => ScribeWebSocketServerLike) | (new (options: { noServer: boolean }) => ScribeWebSocketServerLike) | undefined;
  try {
    const wsModule = (await import('ws' as string)) as {
      WebSocketServer?: new (options: { noServer: boolean }) => ScribeWebSocketServerLike;
      Server?: new (options: { noServer: boolean }) => ScribeWebSocketServerLike;
      default?: {
        WebSocketServer?: new (options: { noServer: boolean }) => ScribeWebSocketServerLike;
        Server?: new (options: { noServer: boolean }) => ScribeWebSocketServerLike;
      };
    };
    // `ws` is CommonJS; under Node's ESM interop the exports appear
    // on `wsModule.default` (which is the CJS module.exports object).
    // Under TS-ESM native builds they may also be hoisted to named
    // exports. Try both shapes.
    WebSocketServer = wsModule.WebSocketServer
      ?? wsModule.default?.WebSocketServer
      ?? wsModule.default?.Server
      ?? wsModule.Server;
    if (!WebSocketServer) {
      logger.info('[ScribeWS] ws module loaded but WebSocketServer not found — streaming disabled');
      return;
    }
  } catch (err) {
    logger.info({ err: (err as Error)?.message }, '[ScribeWS] ws package not available — streaming disabled. Install with: npm i ws @types/ws');
    return;
  }

  // BUG-272 — noServer mode keeps upgrade auth fail-closed at raw HTTP 401.
  const wss: ScribeWebSocketServerLike = new WebSocketServer({ noServer: true });
  const wsSessionIndex = new Map<ScribeWebSocketLike, string>();
  const heartbeat = new ScribeWebSocketHeartbeatController<ScribeWebSocketLike>({
    timeoutMs: Math.max(SCRIBE_WS_HEARTBEAT_TIMEOUT_MS, SCRIBE_WS_HEARTBEAT_INTERVAL_MS * 2),
    closeCode: SCRIBE_WS_CLOSE.HEARTBEAT_TIMEOUT,
    closeReason: 'HEARTBEAT_TIMEOUT',
    onTerminate: (ws) => {
      const sessionId = wsSessionIndex.get(ws);
      if (sessionId) {
        sessions.delete(sessionId);
        wsSessionIndex.delete(ws);
        logger.warn({ sessionId }, '[ScribeWS] Heartbeat timeout terminated stale client session');
      }
    },
  });

  server.on('upgrade', async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (req.url !== '/ws/scribe' && !req.url?.startsWith('/ws/scribe?')) return;
    const auth = await authenticateUpgrade(req, socket);
    if (!auth) return; // authenticateUpgrade already wrote 401 + destroyed socket.
    wss.handleUpgrade(req, socket, head, (ws: ScribeWebSocketLike) => {
      const wsWithAuth = ws as ScribeWebSocketWithAuth;
      wsWithAuth._scribeAuth = auth;
      wss.emit('connection', wsWithAuth, req);
    });
  });

  // Idle session + temp-file cleanup (wrapped so interval never dies on throw).
  const SESSION_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
  const cleanupInterval = setInterval(async () => {
    try {
      const now = Date.now();
      for (const [id, session] of sessions) {
        if (now - session.lastChunkTime > SESSION_IDLE_TIMEOUT_MS) {
          logger.info({ sessionId: id, chunks: session.chunks.length }, '[ScribeWS] Cleaning up idle session');
          sessions.delete(id);
        }
      }
      // Clean up stale temp files older than 10 minutes
      try {
        const { tmpdir } = await import('os');
        const { readdir, unlink, stat } = await import('fs/promises');
        const { join } = await import('path');
        const tempDir = join(tmpdir(), 'signacare-stream');
        // intentional silent — temp dir may not exist on fresh boot
        const files = await readdir(tempDir).catch(() => []);
        for (const f of files) {
          const fp = join(tempDir, f);
          // intentional silent — file may have been removed between readdir and stat
          const s = await stat(fp).catch(() => null);
          if (s && now - s.mtimeMs > 10 * 60_000) {
            // BUG-391 (2026-05-03) — observable best-effort cleanup
            await unlink(fp).catch(err => { logger.debug({ err, fp }, 'scribe stale chunk cleanup failed'); });
          }
        }
      } catch (cleanupErr) { logger.debug({ err: cleanupErr }, '[ScribeWS] temp dir cleanup skipped'); }
    } catch (err) {
      logger.error({ err }, '[ScribeWS] cleanup interval threw — swallowed to keep interval alive');
    }
  }, 60_000); // Check every minute

  // BUG-314 — active Ping/Pong liveness loop.
  const heartbeatInterval = setInterval(() => {
    try {
      heartbeat.tick(wss.clients ?? []);
    } catch (err) {
      logger.error({ err }, '[ScribeWS] heartbeat interval threw — swallowed to keep interval alive');
    }
  }, SCRIBE_WS_HEARTBEAT_INTERVAL_MS);

  // Clean up intervals on server close
  wss.on('close', () => {
    clearInterval(cleanupInterval);
    clearInterval(heartbeatInterval);
  });

  // BUG-042 — close WS sockets before HTTP close to avoid shutdown hangs.
  registerShutdownHook({
    name: 'scribe-websocket',
    priority: 90,
    handler: () => new Promise<void>((resolve) => {
      const clients: ScribeWebSocketLike[] = Array.from(wss.clients ?? []);
      for (const client of clients) {
        try { client.close(1001, 'Server shutting down'); } catch { /* client may be gone */ }
      }
      // 1s grace for polite close, then force terminate stragglers.
      const graceTimer = setTimeout(() => {
        for (const client of clients) {
          try { client.terminate(); } catch { /* client may be gone */ }
        }
      }, 1_000);
      wss.close(() => {
        clearTimeout(graceTimer);
        resolve();
      });
    }),
  });

  wss.on('connection', (ws: ScribeWebSocketLike) => {
    let sessionId = '';
    const auth: AuthContext = (ws as ScribeWebSocketWithAuth)._scribeAuth;
    heartbeat.register(ws);
    const setSessionId = (id: string): void => {
      sessionId = id;
      wsSessionIndex.set(ws, id);
    };

    // BUG-272 — fail-closed if client never sends a valid start message.
    const pendingStartTimer = setTimeout(() => {
      if (!sessionId || sessions.get(sessionId)?.state !== 'ACTIVE') {
        try { ws.close(SCRIBE_WS_CLOSE.SESSION_OPEN_TIMEOUT, 'SESSION_OPEN_TIMEOUT'); } catch { /* ignore */ }
      }
    }, SCRIBE_WS_SESSION_OPEN_TIMEOUT_MS);

    ws.on('message', async (data: Buffer | string) => {
      try {
        // Text messages are control commands
        if (typeof data === 'string' || (data instanceof Buffer && data[0] === 0x7b)) {
          const msg: unknown = JSON.parse(data.toString());
          await handleControlMessage(ws, msg, auth, sessionId, setSessionId, pendingStartTimer);
          return;
        }

        // Binary data is audio chunk
        if (sessionId && sessions.has(sessionId)) {
          const session = sessions.get(sessionId)!;
          // BUG-272 invariant — no audio in PENDING_START ever reaches
          // Whisper or the LLM pipeline. Drop silently. This is the
          // state-machine guarantee behind "unconsented audio is
          // never processed by the backend".
          if (session.state !== 'ACTIVE') return;
          // BUG-274 — per-chunk revocation gate. Runs BEFORE the
          // chunk is pushed to the buffer so a revoked session
          // never accumulates audio post-revoke. Cache-backed (2s
          // TTL + explicit invalidation from the revoke endpoint)
          // so the DB load is minimal. If revoked, enforceRevoked-
          // Consent purges the buffer, closes the WS, and returns
          // true — bail out silently.
          if (await enforceRevokedConsent(ws, session)) return;
          session.chunks.push(Buffer.from(data));
          session.lastChunkTime = Date.now();

          // Transcribe every 5 seconds worth of accumulated audio
          if (session.chunks.length > 0 && session.chunks.length % 5 === 0 && !session.processing) {
            await transcribePartial(ws, session);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err: message }, '[ScribeWS] Message handling error');
        try { ws.send(JSON.stringify({ type: 'error', message })); } catch { /* socket may be closed */ }
      }
    });

    ws.on('close', () => {
      clearTimeout(pendingStartTimer);
      heartbeat.unregister(ws);
      wsSessionIndex.delete(ws);
      if (sessionId) {
        sessions.delete(sessionId);
        logger.info({ sessionId }, '[ScribeWS] Session closed');
      }
    });

    ws.on('pong', () => {
      heartbeat.markPong(ws);
    });

    ws.on('error', (err: Error) => {
      logger.warn({ err: err.message, sessionId }, '[ScribeWS] WebSocket error');
    });
  });

  logger.info('[ScribeWS] WebSocket server initialized on /ws/scribe');
}

async function handleControlMessage(
  ws: ScribeWebSocketLike,
  msg: unknown,
  auth: AuthContext,
  sessionId: string,
  setSessionId: (id: string) => void,
  pendingStartTimer: NodeJS.Timeout,
): Promise<void> {
  const msgType = typeof msg === 'object' && msg !== null && 'type' in msg
    ? (msg as { type?: unknown }).type
    : undefined;
  switch (msgType) {
    case 'start': {
      // BUG-272 — second start on an already-ACTIVE session is a
      // protocol violation (client bug or spoofing attempt). Close
      // rather than silently create a duplicate session.
      if (sessionId && sessions.get(sessionId)?.state === 'ACTIVE') {
        ws.close(SCRIBE_WS_CLOSE.SESSION_ALREADY_OPEN, 'SESSION_ALREADY_OPEN');
        return;
      }

      // BUG-272 Gate 2a — Zod validate. The only acceptable fields are
      // {patientId, consentId} (+ optional format/specialty). Client-
      // supplied staffId / clinicId are IGNORED — session identity
      // comes from the upgrade-time auth context.
      const parsed = StartMessageSchema.safeParse(msg);
      if (!parsed.success) {
        ws.close(SCRIBE_WS_CLOSE.INVALID_SESSION_OPEN, 'INVALID_SESSION_OPEN');
        return;
      }
      const { patientId, consentId, format, specialty } = parsed.data;

      // BUG-272 Gate 2b+c — patient-relationship + recording-consent +
      // audit write. All three run inside withTenantContext so `db`
      // queries pick up app.clinic_id from the RLS-scoped transaction
      // (equivalent to Express's rlsMiddleware for HTTP). Without
      // this wrapper, app_user queries return no rows and
      // verifyRecordingConsent would always throw CONSENT_REQUIRED.
      //
      // recordId = consentId on the audit row binds the recording
      // session to the consent that authorised it — forensic replay
      // can reconstruct the authorisation chain. transport:'websocket'
      // distinguishes WS sessions from the HTTP path (mirrors BUG-035
      // llmRoutes.ts:565).
      try {
        await withTenantContext(auth.clinicId, async () => {
          await requirePatientRelationship(auth, patientId);
          await verifyRecordingConsent(auth.clinicId, patientId, consentId);
          await writeAuditLog({
            clinicId: auth.clinicId,
            userId: auth.staffId,
            action: 'AMBIENT_NOTE_RECORDING_STARTED',
            tableName: 'scribe_consents',
            recordId: consentId,
            newData: { patientId, transport: 'websocket' },
          });
        }, auth.staffId);
      } catch (err) {
        const code = (err as { code?: string }).code ?? 'FORBIDDEN';
        logger.warn({ staffId: auth.staffId, clinicId: auth.clinicId, patientId, code }, '[ScribeWS] Gate 2 rejected');
        ws.close(SCRIBE_WS_CLOSE.FORBIDDEN, code);
        return;
      }

      const id = randomUUID();
      sessions.set(id, {
        id,
        staffId: auth.staffId,   // SSoT: from upgrade-time auth, NEVER from client message
        clinicId: auth.clinicId, // SSoT: from upgrade-time auth, NEVER from client message
        state: 'ACTIVE',
        chunks: [],
        partialTranscript: '',
        lastChunkTime: Date.now(),
        format: format ?? 'soap',
        specialty: specialty ?? 'psychiatry',
        patientId,
        // BUG-274 — bind the consent to the session so per-chunk
        // revocation polling knows what to re-check.
        consentId,
        processing: false,
      });
      setSessionId(id);
      clearTimeout(pendingStartTimer);
      ws.send(JSON.stringify({ type: 'session_started', sessionId: id }));
      logger.info({ sessionId: id, staffId: auth.staffId, patientId }, '[ScribeWS] Session started (gated)');
      break;
    }

    case 'stop': {
      if (!sessionId || !sessions.has(sessionId)) {
        ws.send(JSON.stringify({ type: 'error', message: 'No active session' }));
        return;
      }
      const session = sessions.get(sessionId)!;
      if (session.state !== 'ACTIVE') {
        ws.send(JSON.stringify({ type: 'error', message: 'Session not active' }));
        return;
      }

      // BUG-274 — race resolution: if a revoke landed between the
      // last chunk and the stop message, the revoke wins. Client
      // sees `{type:'revoked'}` not `{type:'result'}` — the
      // post-revoke audio path is NEVER processed.
      if (await enforceRevokedConsent(ws, session)) return;

      // Send final partial transcript
      if (session.chunks.length > 0) {
        await transcribePartial(ws, session);
      }

      // Signal that we're now processing the full note
      ws.send(JSON.stringify({ type: 'processing', message: 'Running medical-grade scribe pipeline...' }));

      try {
        // Combine all chunks and run full pipeline
        const audioBuffer = Buffer.concat(session.chunks);
        const { processAmbientAudio } = await import('./ambientProcessor');
        // Narrow session.format (a free-form string from the client) to the
        // union accepted by processAmbientAudio. Unknown values default to 'soap'.
        const VALID_FORMATS = ['soap', 'mse', 'progress', 'intake', 'all'] as const;
        type OutputFormat = typeof VALID_FORMATS[number];
        const outputFormat: OutputFormat = (VALID_FORMATS as readonly string[]).includes(session.format)
          ? (session.format as OutputFormat)
          : 'soap';
        const result = await processAmbientAudio(audioBuffer, 'audio/webm', {
          clinicId: session.clinicId,
          staffId: session.staffId,
          patientId: session.patientId,
          // BUG-342 — WS scribe sessions bind consent at session-open
          // (BUG-272); thread it to processAmbientAudio so the
          // llm_prompts_outputs row carries consent_id for revocation
          // soft-mark + training-export filtering.
          consentId: session.consentId,
          outputFormat,
        });

        ws.send(JSON.stringify({ type: 'result', data: result }));
      } catch (err) {
        ws.send(JSON.stringify({
          type: 'degraded_mode',
          code: 'SCRIBE_PIPELINE_UNAVAILABLE',
          message: err instanceof Error ? err.message : String(err),
          recovery: {
            sessionId: session.id,
            partialTranscript: session.partialTranscript,
            retryRecommended: true,
            fallback: 'manual_note_from_partial_transcript',
          },
        }));
      }

      session.state = 'STOPPED';
      sessions.delete(sessionId);
      break;
    }

    case 'pause': {
      ws.send(JSON.stringify({ type: 'paused' }));
      break;
    }

    case 'resume': {
      ws.send(JSON.stringify({ type: 'resumed' }));
      break;
    }

    case 'append': {
      // Multi-segment: append to existing session
      if (sessionId && sessions.has(sessionId)) {
        ws.send(JSON.stringify({ type: 'segment_appended', totalChunks: sessions.get(sessionId)!.chunks.length }));
      }
      break;
    }

    default:
      ws.send(JSON.stringify({
        type: 'error',
        message: `Unknown message type: ${typeof msgType === 'string' ? msgType : 'unknown'}`,
      }));
  }
}

/**
 * BUG-274 — on-revoke cleanup for an active streaming session.
 *
 * Invariants (all must hold atomically per session):
 *   1. state → STOPPED BEFORE any further processing — flags future
 *      chunk arrivals as dead.
 *   2. In-memory session.chunks buffer cleared (purge partial audio
 *      so nothing that arrived post-revoke can ever reach Whisper).
 *   3. In-memory session.partialTranscript cleared (any transcribed
 *      text from pre-revoke chunks is dropped).
 *   4. WebSocket actively closes with 4403 + 'RECORDING_REVOKED' so
 *      the client cannot "just keep recording" — server-side close
 *      forces client-side error path.
 *   5. Audit row 'AMBIENT_NOTE_RECORDING_REVOKED' already written by
 *      the /consent/:id/revoke endpoint; this helper does NOT
 *      double-audit on the chunk-enforcement path.
 *   6. sessions.delete(sessionId) so idle-cleanup doesn't re-process.
 *
 * Called from every path that ingests audio/produces transcripts:
 *   - binary-frame message handler
 *   - transcribePartial (start of invocation)
 *   - stop handler (race resolution)
 *
 * Returns true if the session was revoked (caller should bail out);
 * false if the session remains valid.
 */
async function enforceRevokedConsent(ws: ScribeWebSocketLike, session: StreamingSession): Promise<boolean> {
  // Fast path: if state is already STOPPED, treat as revoked — the
  // cleanup has already run (or stop is racing). Bail out without
  // double-work.
  if (session.state !== 'ACTIVE') return true;

  // Poll the consent. isConsentRevoked has a 2s in-process cache +
  // explicit invalidation from the revoke endpoint, so the DB
  // pressure from every-chunk polling is minimal.
  const revoked = await isConsentRevoked(session.consentId, session.clinicId);
  if (!revoked) return false;

  // Invariant 1 — state flip FIRST so any racing chunk sees STOPPED.
  session.state = 'STOPPED';

  // Invariants 2 + 3 — purge in-memory audio + transcript. Before
  // the ws.close so if the buffer-free-at-close runs asynchronously,
  // the buffers are already empty.
  const chunksPurged = session.chunks.length;
  const transcriptChars = session.partialTranscript.length;
  session.chunks = [];
  session.partialTranscript = '';

  // Invariant 4 — notify + close. JSON notify before close so the
  // client has a chance to render a coherent "revoked" message
  // rather than just a socket disconnect.
  try {
    ws.send(JSON.stringify({ type: 'revoked', reason: 'RECORDING_REVOKED' }));
  } catch { /* socket may be closing */ }
  try {
    ws.close(SCRIBE_WS_CLOSE.RECORDING_REVOKED, 'RECORDING_REVOKED');
  } catch { /* ignore */ }

  // Invariant 6 — remove from registry so idle cleanup doesn't
  // re-touch this session.
  sessions.delete(session.id);

  logger.info(
    {
      sessionId: session.id,
      consentId: session.consentId,
      patientId: session.patientId,
      chunksPurged,
      transcriptChars,
    },
    '[ScribeWS] Session revoked mid-flight — in-memory audio + transcript purged',
  );
  return true;
}

async function transcribePartial(ws: ScribeWebSocketLike, session: StreamingSession): Promise<void> {
  // BUG-274 — revocation check BEFORE transcribing any audio. This
  // catches the race where the chunk handler kicked off a transcribe
  // call and the revoke landed between scheduling and execution.
  if (await enforceRevokedConsent(ws, session)) return;

  if (session.processing || session.chunks.length === 0) return;
  session.processing = true;

  try {
    const audioBuffer = Buffer.concat(session.chunks);
    if (audioBuffer.length < 1000) { session.processing = false; return; }

    const tempDir = join(tmpdir(), 'signacare-stream');
    await mkdir(tempDir, { recursive: true });
    const tempFile = join(tempDir, `stream-${session.id}-${Date.now()}.webm`);
    await writeFile(tempFile, audioBuffer);

    try {
      const FormData = (await import('form-data')).default;
      const fs = await import('fs');
      const form = new FormData();
      const partialStream = fs.createReadStream(tempFile);
      partialStream.on('error', (err) => logger.error({ err }, 'Stream error'));
      form.append('file', partialStream);
      form.append('language', 'en');

      const resp = await axios.post(`${WHISPER_API_URL}/inference`, form, {
        headers: form.getHeaders(),
        timeout: 30000,
      });

      const text = resp.data?.text?.trim() ?? '';
      if (text && text !== session.partialTranscript) {
        session.partialTranscript = text;
        ws.send(JSON.stringify({
          type: 'partial_transcript',
          text,
          timestamp: Date.now(),
          wordCount: text.split(/\s+/).length,
        }));
      }
    } finally {
      // BUG-391 (2026-05-03) — observable best-effort cleanup
      await unlink(tempFile).catch(err => { logger.debug({ err, tempFile }, 'scribe partial-transcription temp cleanup failed'); });
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), sessionId: session.id }, '[ScribeWS] Partial transcription failed');
    try {
      ws.send(JSON.stringify({
        type: 'degraded_mode',
        code: 'SCRIBE_PARTIAL_UNAVAILABLE',
        message: err instanceof Error ? err.message : String(err),
        recovery: {
          sessionId: session.id,
          retryRecommended: true,
        },
      }));
    } catch {
      // socket may be closing; best-effort signal only
    }
  } finally {
    session.processing = false;
  }
}

/**
 * Faster-Whisper VAD Configuration
 *
 * When using faster-whisper with Silero VAD, the server-side
 * can automatically detect speech boundaries and only process
 * voiced segments. This configuration is sent to the Whisper
 * server if it supports VAD.
 */
export const WHISPER_VAD_CONFIG = {
  vad_filter: true,
  vad_parameters: {
    threshold: 0.5,           // Speech probability threshold
    min_speech_duration_ms: 250,  // Minimum speech segment
    max_speech_duration_s: 30,     // Max segment before forced split
    min_silence_duration_ms: 500,  // Silence gap to split segments
    speech_pad_ms: 200,            // Padding around speech
  },
  // Clinical vocabulary boost words
  initial_prompt: 'Mental health clinical consultation. Patient, clinician, medication, ' +
    'olanzapine, risperidone, quetiapine, aripiprazole, clozapine, sertraline, ' +
    'fluoxetine, escitalopram, venlafaxine, lithium, sodium valproate, lamotrigine, ' +
    'diazepam, lorazepam, suicidal ideation, self-harm, psychosis, hallucination, ' +
    'delusion, paranoid, depression, anxiety, PTSD, bipolar, schizophrenia, ' +
    'mental state examination, MSE, PHQ-9, GAD-7, K10, HoNOS.',
};

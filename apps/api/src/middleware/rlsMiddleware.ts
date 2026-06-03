// apps/api/src/middleware/rlsMiddleware.ts
//
// Wraps each authenticated request in a database transaction with
// SET LOCAL app.clinic_id (and optionally app.user_id).
//
// The transaction is stored in AsyncLocalStorage so the `db` proxy
// in db.ts transparently routes all queries through it — no changes
// needed in route handlers or repositories.
//
// On response finish: transaction commits.
// On error:           transaction rolls back.

import type { Request, Response, NextFunction } from "express";
import { appPoolRaw, rlsStore } from "../db/db";
import { logger } from "../utils/logger";

const RLS_REQUEST_GUARD = Symbol("rls_request_guard");

// Routes that can legitimately hold a connection open while waiting on
// external engines (LLM/Whisper/SSE). These paths are guarded via
// explicit clinic_id + auth checks in their own handlers and must not
// pin an RLS transaction for minutes.
const RLS_LONG_LIVED_PATHS = new Set<string>([
  "/api/v1/llm/clinical-ai",
  "/api/v1/llm/ambient-note",
  "/api/v1/llm/agent",
  "/api/v1/scribe/stream-chunk",
  "/api/v1/scribe/stream-final",
]);

function requestPathWithoutQuery(req: Request): string {
  const raw = req.originalUrl ?? req.path;
  const q = raw.indexOf("?");
  return q >= 0 ? raw.slice(0, q) : raw;
}

function shouldBypassRls(req: Request): boolean {
  const fullPath = requestPathWithoutQuery(req);
  if (fullPath.startsWith("/api/v1/events")) return true;
  if (req.headers.accept === "text/event-stream") return true;
  return RLS_LONG_LIVED_PATHS.has(fullPath);
}

/**
 * BUG-722 — Knex transaction clients share one pg connection. When route code
 * issues parallel Promise.all queries through the request-scoped `db` proxy,
 * pg warns (`client.query() while already executing query`) and will hard-fail
 * in pg@9.
 *
 * We harden at the transaction-client boundary by serializing query dispatch
 * per RLS transaction. This preserves correctness (single connection cannot
 * truly execute SQL in parallel anyway), removes warning noise, and avoids
 * requiring ad-hoc per-route Promise.all rewrites.
 */
/**
 * RLS middleware — called by authMiddleware after JWT verification.
 *
 * Skips RLS scoping when:
 *   - No clinicId on the request (shouldn't happen if called from authMiddleware)
 *   - SSE/long-lived connections (would hold transaction open indefinitely)
 */
export function rlsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip for unauthenticated requests (safety — should not happen)
  if (!req.clinicId) {
    next();
    return;
  }

  // Evaluate bypass BEFORE mutating request-scoped guard state. A
  // bypassed outer middleware invocation (e.g. broad router mount)
  // must not suppress a later eligible invocation on the same request.
  if (shouldBypassRls(req)) {
    next();
    return;
  }

  // Structural safety: if authMiddleware is invoked more than once on the
  // SAME request object (e.g. broad router mounts plus feature-router auth),
  // re-entering rlsMiddleware would open nested transactions and attach
  // duplicate response listeners.
  //
  // Important: this guard must be request-scoped, not AsyncLocalStorage-
  // scoped. Using `rlsStore.getStore()` here leaks across legitimately
  // concurrent requests started in the same async parent context
  // (e.g. Promise.all integration races), causing one request to skip RLS
  // setup entirely and re-introduce nondeterministic behavior.
  const reqWithRls = req as Request & { [RLS_REQUEST_GUARD]?: boolean };
  if (reqWithRls[RLS_REQUEST_GUARD]) {
    next();
    return;
  }
  reqWithRls[RLS_REQUEST_GUARD] = true;

  appPoolRaw
    .transaction(async (trx) => {
      // Set tenant context — SET LOCAL only lives within this transaction.
      // SET doesn't support $1 placeholders — use set_config() which does.
      await trx.raw("SELECT set_config('app.clinic_id', ?, true)", [req.clinicId]);

      if (req.user?.id) {
        await trx.raw("SELECT set_config('app.user_id', ?, true)", [req.user.id]);
      }

      // Safety: cap statement timeout within the transaction
      await trx.raw("SET LOCAL statement_timeout = '30s'");

      // Run the rest of the middleware/route chain inside AsyncLocalStorage
      // so the db proxy picks up this transaction automatically.
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const onFinish = () => settle();
        const onClose = () => {
          if (!res.writableFinished) {
            settle(new Error("Client disconnected"));
          }
        };
        const cleanup = () => {
          res.removeListener("finish", onFinish);
          res.removeListener("close", onClose);
        };
        const settle = (err?: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (err) reject(err);
          else resolve();
        };

        rlsStore.run(trx, () => {
          // Commit when response finishes successfully
          res.once("finish", onFinish);
          // Rollback if client disconnects before response completes
          res.once("close", onClose);

          next();
        });
      });
    })
    .catch((err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      if (error.message === "Client disconnected") {
        return;
      }

      // Transaction rolled back — pass error to Express error handler
      logger.error({ err: error.message, requestId: req.requestId }, "RLS transaction error");
      if (!res.headersSent) {
        next(error);
      }
    });
}

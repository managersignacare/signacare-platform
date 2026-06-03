// apps/api/src/shared/errors.ts

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR"
  | "INVALID_CREDENTIALS"
  | "MFA_REQUIRED"
  | "MFA_NOT_CONFIGURED"
  | "SESSION_EXPIRED"
  | "DUPLICATE_PATIENT"
  | "INVALID_TIME_RANGE"
  | string;

export const ErrorCode = {
  BAD_REQUEST: "BAD_REQUEST" as const,
  UNAUTHENTICATED: "UNAUTHENTICATED" as const,
  FORBIDDEN: "FORBIDDEN" as const,
  NOT_FOUND: "NOT_FOUND" as const,
  CONFLICT: "CONFLICT" as const,
  VALIDATION_ERROR: "VALIDATION_ERROR" as const,
  INTERNAL_ERROR: "INTERNAL_ERROR" as const,
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS" as const,
  MFA_REQUIRED: "MFA_REQUIRED" as const,
  MFA_NOT_CONFIGURED: "MFA_NOT_CONFIGURED" as const,
  SESSION_EXPIRED: "SESSION_EXPIRED" as const,
  DUPLICATE_PATIENT: "DUPLICATE_PATIENT" as const,
};

/** Convenience alias: (message, status, code) arg order used in services */
/** Convenience alias: (message, status, code) arg order used in services */
export class AppError extends HttpError {
  constructor(message: string, status: number, code: ErrorCode, details?: unknown) {
    super(status, code, message, details);
  }
}

export function toErrorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return {
      status: err.status,
      body: {
        error: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      },
    };
  }

  // Zod validation errors — map to 422 with structured field details.
  // Without this branch, CreateFooSchema.parse(req.body) throws a
  // ZodError that falls through to the generic 500, and every route
  // that uses Zod emits "Internal server error" on any validation
  // failure. This is the underlying cause of the three patientCrud
  // it.fails markers (missing field → 500, non-UUID → 500).
  if (
    err &&
    typeof err === "object" &&
    (err as { name?: string }).name === "ZodError" &&
    Array.isArray((err as { issues?: unknown }).issues)
  ) {
    const zerr = err as { issues: Array<{ path: (string | number)[]; message: string; code?: string }> };
    return {
      status: 422,
      body: {
        error: "Request validation failed",
        code: "VALIDATION_ERROR" as const,
        details: zerr.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
          ...(i.code ? { code: i.code } : {}),
        })),
      },
    };
  }

  // Duck-typed errors: plain Error objects with `status` + `code`
  // properties assigned via Object.assign. This pattern is used by
  // services throughout the codebase (e.g. NOTE_CONFLICT from the
  // clinical-notes optimistic-lock guard, NOTE_NOT_FOUND from the
  // service layer). Without this branch they would fall through to
  // the generic 500 below and lose their HTTP semantics.
  if (
    err instanceof Error &&
    typeof (err as { status?: unknown }).status === "number" &&
    typeof (err as { code?: unknown }).code === "string"
  ) {
    const e = err as Error & { status: number; code: string; details?: unknown };
    return {
      status: e.status,
      body: {
        error: e.message,
        code: e.code,
        ...(e.details ? { details: e.details } : {}),
      },
    };
  }

  // BUG-367 — PostgreSQL SQLSTATE error classes that represent retry-
  // able failure modes. node-postgres surfaces these as Error objects
  // with `code` set to the SQLSTATE (5 characters) but no `status`
  // property, so they fall through the duck-typed branch above.
  // Without this mapping, a 55P03 lock_timeout (which BUG-187's
  // 5-second lock_timeout guard intentionally raises) becomes an
  // opaque 500 "Internal server error" — the clinician sees a
  // generic failure and has no signal to retry. Mapping these to
  // 503/504 with a distinct code lets the UI + operators handle
  // them correctly.
  if (
    err instanceof Error &&
    typeof (err as { code?: unknown }).code === "string" &&
    PG_RETRYABLE_SQLSTATES[((err as unknown as { code: string }).code).toUpperCase()] !== undefined
  ) {
    const pgCode = (err as unknown as { code: string }).code.toUpperCase();
    const mapping = PG_RETRYABLE_SQLSTATES[pgCode]!;
    return {
      status: mapping.status,
      body: {
        error: mapping.message,
        code: mapping.code,
        // Surface the SQLSTATE so structured-log / Sentry tagging
        // can group by the real DB failure mode, not just the HTTP
        // status.
        details: { sqlstate: pgCode, retryable: mapping.retryable },
      },
    };
  }

  // BUG-040 — DB-level prescribing-discipline trigger fallback.
  // Service guards should block first, but if a path bypasses them
  // (or data drifts between read and write), the trigger raises a
  // plain PG error (typically SQLSTATE P0001). Map that to the same
  // contract as requirePrescribingDiscipline so callers never see a
  // raw 500 for this clinical-authorization failure class.
  if (
    err instanceof Error &&
    isPrescribingDisciplineTriggerError(
      (err as { code?: string }).code,
      err.message,
    )
  ) {
    return {
      status: 403,
      body: {
        error: "Prescribing requires an authorised AHPRA discipline",
        code: "PRESCRIBING_DISCIPLINE_REQUIRED" as const,
      },
    };
  }

  // Uncaught PG unique-constraint violations (SQLSTATE 23505) used to
  // fall through to generic 500 responses. Map them to 409 with a
  // non-PHI field hint so operators can self-correct input.
  if (
    err instanceof Error &&
    (err as { code?: string }).code?.toUpperCase() === "23505"
  ) {
    const pg = err as Error & {
      code?: string;
      detail?: string;
      constraint?: string;
      table?: string;
    };
    const fieldMatch = pg.detail?.match(/Key \(([^)]+)\)=\(/i);
    const field = fieldMatch?.[1];
    const fieldLabel = field?.replace(/_/g, " ");
    return {
      status: 409,
      body: {
        error: fieldLabel
          ? `A record with this ${fieldLabel} already exists.`
          : "A record with the same unique value already exists.",
        code: "CONFLICT" as const,
        details: {
          sqlstate: "23505",
          ...(pg.constraint ? { constraint: pg.constraint } : {}),
          ...(pg.table ? { table: pg.table } : {}),
          ...(field ? { field } : {}),
        },
      },
    };
  }

  // NOT NULL violation (SQLSTATE 23502) — surface as validation failure
  // instead of generic 500 so clients can correct input / required fields.
  if (
    err instanceof Error &&
    (err as { code?: string }).code?.toUpperCase() === "23502"
  ) {
    const pg = err as Error & { code?: string; detail?: string; column?: string };
    const fromDetail = pg.detail?.match(/null value in column "([^"]+)"/i)?.[1];
    const field = pg.column ?? fromDetail ?? null;
    return {
      status: 422,
      body: {
        error: field
          ? `Missing required field: ${field}`
          : "Missing required field value",
        code: "VALIDATION_ERROR" as const,
        details: {
          sqlstate: "23502",
          ...(field ? { field } : {}),
        },
      },
    };
  }

  // String data right truncation (SQLSTATE 22001) — value exceeds column
  // length. Surface as validation failure so callers can correct input
  // instead of seeing opaque INTERNAL_ERROR.
  if (
    err instanceof Error &&
    (err as { code?: string }).code?.toUpperCase() === "22001"
  ) {
    const pg = err as Error & { detail?: string; message: string };
    const source = pg.detail ?? pg.message;
    const len = source.match(/character varying\((\d+)\)/i)?.[1] ?? null;
    return {
      status: 422,
      body: {
        error: len
          ? `One or more fields exceed maximum length (${len} characters).`
          : "One or more fields exceed maximum length.",
        code: "VALIDATION_ERROR" as const,
        details: {
          sqlstate: "22001",
          ...(len ? { maxLength: Number(len) } : {}),
        },
      },
    };
  }

  // Schema drift / migration mismatch (undefined table / undefined column).
  // Common during local env drift when code is newer than DB.
  if (
    err instanceof Error &&
    ["42P01", "42703"].includes(
      ((err as { code?: string }).code ?? "").toUpperCase(),
    )
  ) {
    return {
      status: 503,
      body: {
        error: "Database schema mismatch. Run migrations and restart the API.",
        code: "SCHEMA_MISMATCH" as const,
      },
    };
  }

  // Runtime configuration failure mapping — if cryptographic identifier
  // keys are missing/malformed, patient create/update paths can throw
  // plain Error. Return an explicit operator-actionable envelope
  // instead of opaque INTERNAL_ERROR so UI and logs are truthful.
  if (
    err instanceof Error &&
    /BLIND_INDEX_KEY|PHI_ENCRYPTION_KEY/i.test(err.message)
  ) {
    return {
      status: 503,
      body: {
        error: "Server configuration error: missing or invalid identifier security keys. Contact your administrator.",
        code: "CONFIGURATION_ERROR" as const,
      },
    };
  }

  if (err instanceof Error) {
    return {
      status: 500,
      body: {
        error: "Internal server error",
        code: "INTERNAL_ERROR" as const,
      },
    };
  }

  return {
    status: 500,
    body: {
      error: "Unknown error",
      code: "INTERNAL_ERROR" as const,
    },
  };
}

function isPrescribingDisciplineTriggerError(
  code: string | undefined,
  message: string,
): boolean {
  const upper = code?.toUpperCase();
  if (upper !== undefined && upper !== "P0001" && upper !== "23514") {
    return false;
  }

  return /prescriber discipline .*not authorised to prescribe \(BUG-040\)/i.test(message)
    || /prescriber staff\.discipline is null or unset/i.test(message);
}

/**
 * BUG-367 — PostgreSQL SQLSTATE → HTTP response mapping for retryable
 * DB errors. Only includes codes that represent transient failure
 * modes where retrying is the correct client action; permanent errors
 * (syntax error, undefined column, etc.) fall through to 500.
 *
 * Reference: https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const PG_RETRYABLE_SQLSTATES: Record<string, {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
}> = {
  // Class 25 — Invalid Transaction State
  "25P03": {
    status: 503,
    code: "IDLE_IN_TX_TIMEOUT",
    message: "Database session was terminated (idle-in-transaction). Please retry.",
    retryable: true,
  },
  // Class 40 — Transaction Rollback
  "40001": {
    status: 503,
    code: "SERIALIZATION_FAILURE",
    message: "Transaction serialization failed. Please retry.",
    retryable: true,
  },
  "40P01": {
    status: 503,
    code: "DEADLOCK_DETECTED",
    message: "Deadlock detected. Please retry.",
    retryable: true,
  },
  // Class 55 — Object Not In Prerequisite State
  "55P03": {
    status: 503,
    code: "LOCK_TIMEOUT_RETRY",
    message: "Database lock wait timed out. Please retry in a moment.",
    retryable: true,
  },
  // Class 57 — Operator Intervention
  "57014": {
    status: 504,
    code: "STATEMENT_TIMEOUT",
    message: "Database query exceeded its 30-second timeout. The operation was cancelled; please retry or narrow the query.",
    retryable: true,
  },
  "57P03": {
    status: 503,
    code: "CANNOT_CONNECT_NOW",
    message: "Database is restarting. Please retry in a moment.",
    retryable: true,
  },
};

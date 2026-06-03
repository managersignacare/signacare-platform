// apps/api/src/middleware/errorHandler.ts
import type { Request, Response, NextFunction } from "express";
import { toErrorResponse } from "../shared/errors";
import { logger } from "../utils/logger";

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  // @intentional: Express error middleware signature requires NextFunction.
  _next: NextFunction
) {
  const { status, body } = toErrorResponse(err);
  logger.error(
    {
      err,
      requestId: req.requestId,
      clinicId: req.clinicId,
      staffId: req.user?.id,
    },
    "Unhandled error"
  );
  res.status(status).json(body);
}

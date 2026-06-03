// apps/api/src/middleware/validationMiddleware.ts
import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";
import { HttpError } from "../shared/errors";

export function validateBody(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      throw new HttpError(
        // Keep validation failures semantically aligned with direct
        // `schema.parse(req.body)` paths, which are mapped to 422 by
        // toErrorResponse(). 400 is reserved for malformed transport-
        // level request shape, while 422 expresses syntactically valid
        // JSON with domain-schema violations.
        422,
        "VALIDATION_ERROR",
        "Invalid request body",
        result.error
      );
    }
    req.body = result.data;
    next();
  };
}

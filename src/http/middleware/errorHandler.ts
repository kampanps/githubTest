import type { NextFunction, Request, Response } from 'express';
import { AppError, isAppError } from '../../domain/errors';

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Catch-all for URLs that matched no route. */
export function notFoundHandler() {
  return (req: Request, res: Response): void => {
    const body: ErrorBody = {
      error: {
        code: 'ROUTE_NOT_FOUND',
        message: `Cannot ${req.method} ${req.path}`,
        ...(req.requestId ? { requestId: req.requestId } : {}),
      },
    };
    res.status(404).json(body);
  };
}

/**
 * Turns anything thrown inside a route into a consistent JSON envelope.
 * Unknown errors become a 500 with no internal details leaked.
 */
export function errorHandler(logger: Pick<Console, 'error'> = console) {
  return (error: unknown, req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (isAppError(error)) {
      const body: ErrorBody = {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          ...(req.requestId ? { requestId: req.requestId } : {}),
        },
      };
      res.status(error.statusCode).json(body);
      return;
    }

    // Express rejects malformed JSON bodies before any route runs.
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({
        error: {
          code: 'MALFORMED_JSON',
          message: 'Request body is not valid JSON',
          ...(req.requestId ? { requestId: req.requestId } : {}),
        },
      } satisfies ErrorBody);
      return;
    }

    logger.error('[unhandled]', { requestId: req.requestId, error });

    const fallback = new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
    res.status(fallback.statusCode).json({
      error: {
        code: fallback.code,
        message: fallback.message,
        ...(req.requestId ? { requestId: req.requestId } : {}),
      },
    } satisfies ErrorBody);
  };
}

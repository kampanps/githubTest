import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError, UnauthorizedError } from '../../domain/errors';
import type { Role } from '../../domain/types';

/**
 * Resolves the `x-api-key` header into a role. Unknown or missing keys are
 * rejected here rather than in each route.
 */
export function apiKeyAuth(apiKeys: Record<string, Role>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const key = req.header('x-api-key');
    if (!key) {
      next(new UnauthorizedError('x-api-key header is required'));
      return;
    }

    const role = apiKeys[key];
    if (!role) {
      next(new UnauthorizedError('Unknown API key'));
      return;
    }

    req.role = role;
    next();
  };
}

export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.role) {
      next(new UnauthorizedError());
      return;
    }
    if (!allowed.includes(req.role)) {
      next(new ForbiddenError(`This endpoint requires one of: ${allowed.join(', ')}`));
      return;
    }
    next();
  };
}

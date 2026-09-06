import type { Role } from '../domain/types';

declare global {
  namespace Express {
    interface Request {
      /** Set by the auth middleware once the x-api-key header is resolved. */
      role?: Role;
      requestId?: string;
    }
  }
}

export {};

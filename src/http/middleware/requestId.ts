import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/** Stamps every request/response pair with an id so CI logs are traceable. */
export function requestId() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const incoming = req.header('x-request-id');
    const id = incoming && incoming.trim() !== '' ? incoming.trim() : randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  };
}

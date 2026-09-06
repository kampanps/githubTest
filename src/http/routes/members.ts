import { Router } from 'express';
import type { Services } from '../../container';
import { ValidationError } from '../../domain/errors';
import { toPositiveInt } from '../../domain/validation';
import { requireRole } from '../middleware/auth';
import { requireIdParam } from '../params';

export function createMemberRouter(services: Services): Router {
  const router = Router();

  router.get('/', requireRole('ADMIN', 'LIBRARIAN'), (req, res) => {
    res.json(services.members.list(req.query as Record<string, unknown>));
  });

  router.post('/', requireRole('ADMIN', 'LIBRARIAN'), (req, res) => {
    res.status(201).json(services.members.create(req.body));
  });

  router.get('/:id', (req, res) => {
    res.json(services.members.getById(requireIdParam(req.params.id)));
  });

  router.get('/:id/summary', (req, res) => {
    res.json(services.members.summary(requireIdParam(req.params.id)));
  });

  router.get('/:id/fines', (req, res) => {
    const status = req.query.status;
    res.json(
      services.fines.statement(
        requireIdParam(req.params.id),
        status === 'UNPAID' || status === 'PAID' || status === 'WAIVED' ? status : undefined,
      ),
    );
  });

  router.post('/:id/suspend', requireRole('ADMIN', 'LIBRARIAN'), (req, res) => {
    res.json(services.members.setStatus(requireIdParam(req.params.id), 'SUSPENDED'));
  });

  router.post('/:id/activate', requireRole('ADMIN', 'LIBRARIAN'), (req, res) => {
    res.json(services.members.setStatus(requireIdParam(req.params.id), 'ACTIVE'));
  });

  router.post('/:id/renew-membership', requireRole('ADMIN', 'LIBRARIAN'), (req, res) => {
    const months = toPositiveInt((req.body as { months?: unknown } | undefined)?.months);
    if (months === null) {
      throw new ValidationError([{ field: 'months', message: 'months must be a positive integer' }]);
    }
    res.json(services.members.renewMembership(requireIdParam(req.params.id), months));
  });

  return router;
}

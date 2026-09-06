import { Router } from 'express';
import type { Services } from '../../container';
import { requireRole } from '../middleware/auth';
import { requireIdParam } from '../params';

export function createLoanRouter(services: Services): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(services.loans.list(req.query as Record<string, unknown>));
  });

  router.get('/overdue', requireRole('ADMIN', 'LIBRARIAN'), (req, res) => {
    res.json(services.loans.listOverdue(req.query as Record<string, unknown>));
  });

  router.get('/:id', (req, res) => {
    res.json(services.loans.getById(requireIdParam(req.params.id)));
  });

  router.post('/', (req, res) => {
    res.status(201).json(services.loans.borrow(req.body));
  });

  router.post('/:id/return', (req, res) => {
    res.json(services.loans.returnLoan(requireIdParam(req.params.id)));
  });

  router.post('/:id/renew', (req, res) => {
    res.json(services.loans.renew(requireIdParam(req.params.id)));
  });

  return router;
}

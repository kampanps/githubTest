import { Router } from 'express';
import type { Services } from '../../container';
import { requireRole } from '../middleware/auth';
import { requireIdParam } from '../params';

export function createFineRouter(services: Services): Router {
  const router = Router();

  router.post('/:id/pay', (req, res) => {
    res.json(services.fines.pay(requireIdParam(req.params.id)));
  });

  router.post('/:id/waive', requireRole('ADMIN'), (req, res) => {
    res.json(services.fines.waive(requireIdParam(req.params.id)));
  });

  return router;
}

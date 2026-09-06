import { Router } from 'express';
import type { Services } from '../../container';
import { requireIdParam } from '../params';

export function createReservationRouter(services: Services): Router {
  const router = Router();

  router.post('/', (req, res) => {
    res.status(201).json(services.reservations.reserve(req.body));
  });

  router.get('/:id', (req, res) => {
    res.json(services.reservations.getById(requireIdParam(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    res.json(services.reservations.cancel(requireIdParam(req.params.id)));
  });

  return router;
}

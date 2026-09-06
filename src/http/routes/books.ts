import { Router } from 'express';
import type { Services } from '../../container';
import { requireRole } from '../middleware/auth';
import { requireIdParam } from '../params';

export function createBookRouter(services: Services): Router {
  const router = Router();

  router.get('/', (req, res) => {
    res.json(services.books.list(req.query as Record<string, unknown>));
  });

  router.get('/:id', (req, res) => {
    res.json(services.books.getById(requireIdParam(req.params.id)));
  });

  router.get('/:id/reservations', (req, res) => {
    res.json({ data: services.reservations.queue(requireIdParam(req.params.id)) });
  });

  router.post('/', requireRole('ADMIN', 'LIBRARIAN'), (req, res) => {
    res.status(201).json(services.books.create(req.body));
  });

  router.patch('/:id', requireRole('ADMIN', 'LIBRARIAN'), (req, res) => {
    res.json(services.books.update(requireIdParam(req.params.id), req.body));
  });

  router.delete('/:id', requireRole('ADMIN'), (req, res) => {
    services.books.remove(requireIdParam(req.params.id));
    res.status(204).send();
  });

  return router;
}

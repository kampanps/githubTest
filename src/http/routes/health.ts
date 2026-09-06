import { Router } from 'express';
import type { Container } from '../../container';
import { currentSchemaVersion } from '../../db/migrate';

export function createHealthRouter(container: Container): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: container.clock().toISOString() });
  });

  // Readiness actually touches the database - a liveness probe that never talks
  // to its dependencies is not worth much in a pipeline.
  router.get('/ready', (_req, res) => {
    try {
      const version = currentSchemaVersion(container.db);
      res.json({ status: 'ready', schemaVersion: version });
    } catch {
      res.status(503).json({ status: 'unavailable', schemaVersion: null });
    }
  });

  return router;
}

import express, { type Express } from 'express';
import type { Container } from '../container';
import { apiKeyAuth } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import { createBookRouter } from './routes/books';
import { createFineRouter } from './routes/fines';
import { createHealthRouter } from './routes/health';
import { createLoanRouter } from './routes/loans';
import { createMemberRouter } from './routes/members';
import { createReservationRouter } from './routes/reservations';

export function createApp(container: Container): Express {
  const app = express();

  app.disable('x-powered-by');
  // requestId first: a malformed JSON body fails inside express.json(), and we
  // still want that error response to carry a correlation id.
  app.use(requestId());
  app.use(express.json({ limit: '100kb' }));

  // Health probes stay unauthenticated so CI can poll them without a key.
  app.use('/', createHealthRouter(container));

  const api = express.Router();
  api.use(apiKeyAuth(container.config.apiKeys));
  api.use('/books', createBookRouter(container.services));
  api.use('/members', createMemberRouter(container.services));
  api.use('/loans', createLoanRouter(container.services));
  api.use('/reservations', createReservationRouter(container.services));
  api.use('/fines', createFineRouter(container.services));

  app.use('/api', api);

  app.use(notFoundHandler());
  app.use(errorHandler(container.config.nodeEnv === 'test' ? { error: () => undefined } : console));

  return app;
}

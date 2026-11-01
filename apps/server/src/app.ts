import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ERROR_CODES } from '@online-exam/shared';
import { handleError } from './core/http/error-handler.js';
import { questionsRouter } from './modules/questions/controllers/questions.controller.js';

export function createApp(clientOrigin: string) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  // Liveness only: does not claim PostgreSQL/Redis readiness.
  app.get('/api/v1/health', (_req, res) =>
    res.json({ data: { status: 'ok' } }),
  );
  app.use('/api/v1/questions', questionsRouter);
  app.use((_req, res) =>
    res.status(404).json({
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' },
    }),
  );
  app.use(handleError);
  return app;
}

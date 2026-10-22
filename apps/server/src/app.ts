import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ERROR_CODES } from '@online-exam/shared';

export function createApp(clientOrigin: string) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  // Liveness only: does not claim PostgreSQL/Redis readiness.
  app.get('/api/v1/health', (_req, res) =>
    res.json({ data: { status: 'ok' } }),
  );
  app.use((_req, res) =>
    res.status(404).json({
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' },
    }),
  );
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid JSON',
        },
      });
      return;
    }
    res.status(500).json({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Internal server error',
      },
    });
  };
  app.use(handleError);
  return app;
}

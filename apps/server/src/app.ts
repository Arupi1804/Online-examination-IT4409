import express, { type ErrorRequestHandler, type Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ERROR_CODES } from '@online-exam/shared';
import { ZodError } from 'zod';
import { AuthError } from './modules/auth/errors.js';

export function createApp(
  clientOrigin: string,
  options: { authRouter?: Router; trustProxyHops?: number } = {},
) {
  const app = express();
  app.set('trust proxy', options.trustProxyHops ?? 0);
  app.use(helmet());
  app.use(cors({ origin: clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  // Liveness only: does not claim PostgreSQL/Redis readiness.
  app.get('/api/v1/health', (_req, res) =>
    res.json({ data: { status: 'ok' } }),
  );
  if (options.authRouter) app.use('/api/v1/auth', options.authRouter);
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
    if (error instanceof AuthError) {
      if (error.status === 429) res.setHeader('Retry-After', '900');
      res.status(error.status).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        error: {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: 'Invalid input',
          details: error.issues.map((issue) => ({
            field: issue.path.join('.'),
            issue: issue.message,
          })),
        },
      });
      return;
    }
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

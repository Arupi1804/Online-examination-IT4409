import express, { type RequestHandler, type Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { ERROR_CODES } from '@online-exam/shared';
import { handleError } from './core/http/error-handler.js';

export function createApp(
  clientOrigin: string,
  options: {
    authRouter?: Router;
    apiRouter?: Router;
    sessionMiddleware?: RequestHandler;
    trustProxyHops?: number;
  } = {},
) {
  if ((options.authRouter || options.apiRouter) && !options.sessionMiddleware)
    throw new Error('API routers require the shared session middleware');
  const app = express();
  app.set('trust proxy', options.trustProxyHops ?? 0);
  app.use(helmet());
  app.use(cors({ origin: clientOrigin, credentials: true }));
  // Include parser/session errors in the Auth no-store policy.
  app.use('/api/v1/auth', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  // Liveness only: does not claim PostgreSQL/Redis readiness.
  app.get('/api/v1/health', (_req, res) =>
    res.json({ data: { status: 'ok' } }),
  );
  if (options.sessionMiddleware) app.use('/api/v1', options.sessionMiddleware);
  if (options.authRouter) app.use('/api/v1/auth', options.authRouter);
  if (options.apiRouter) app.use('/api/v1', options.apiRouter);
  app.use((_req, res) =>
    res.status(404).json({
      error: { code: ERROR_CODES.NOT_FOUND, message: 'Endpoint not found' },
    }),
  );
  app.use(handleError);
  return app;
}

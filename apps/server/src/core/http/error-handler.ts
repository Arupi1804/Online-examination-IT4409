import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES } from '@online-exam/shared';
import { HttpError } from '../errors/http-error.js';

/** Express 4 does not forward rejected promises automatically. */
export const handle =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export const handleError: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  _next,
) => {
  if (error instanceof HttpError) {
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
      error: { code: ERROR_CODES.VALIDATION_FAILED, message: 'Invalid JSON' },
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

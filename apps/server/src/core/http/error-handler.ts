import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { ERROR_CODES } from '@online-exam/shared';
import { HttpError } from '../errors/http-error.js';

/** Express 4 ignores rejected promises; forward them to the error handler. */
export const handle =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export const handleError: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof HttpError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'Invalid input',
        details: error.issues.map((i) => ({
          field: i.path.join('.'),
          issue: i.message,
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
  console.error(error);
  res.status(500).json({
    error: {
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Internal server error',
    },
  });
};

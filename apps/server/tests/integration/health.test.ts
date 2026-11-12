import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { Router } from 'express';
import { createApp } from '../../src/app.js';
import { HttpError } from '../../src/core/errors/http-error.js';
import { handle } from '../../src/core/http/error-handler.js';

describe('API foundation', () => {
  const app = createApp('http://localhost:5173');
  it('returns the contract envelope and allows credentialed client requests', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: 'ok' } });
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
  it('returns contract errors for unknown endpoints', async () => {
    const response = await request(app).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
  it('rejects malformed JSON with a validation error', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('requires shared session middleware when mounting API routers', () => {
    expect(() =>
      createApp('http://localhost:5173', { apiRouter: Router() }),
    ).toThrow('shared session middleware');
  });
  it('handles business HTTP errors with the same envelope as Auth', async () => {
    const router = Router();
    router.get(
      '/conflict',
      handle(async () => {
        throw new HttpError(409, 'QUESTION_IN_USE', 'Question is in use', [
          { field: 'questionId', issue: 'in use' },
        ]);
      }),
    );
    router.get(
      '/unexpected',
      handle(async () => {
        throw new Error('private diagnostic');
      }),
    );
    const api = createApp('http://localhost:5173', {
      apiRouter: router,
      sessionMiddleware: (_req, _res, next) => next(),
    });
    const response = await request(api).get('/api/v1/conflict').expect(409);
    expect(response.body.error).toEqual({
      code: 'QUESTION_IN_USE',
      message: 'Question is in use',
      details: [{ field: 'questionId', issue: 'in use' }],
    });
    const internal = await request(api).get('/api/v1/unexpected').expect(500);
    expect(internal.body.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });
});

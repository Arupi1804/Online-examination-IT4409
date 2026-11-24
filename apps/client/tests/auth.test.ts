import assert from 'node:assert/strict';
import { afterEach, vi, test } from 'vitest';
import { apiFetch, ApiError } from '../src/services/api.ts';
import { getAuthErrorMessage } from '../src/features/auth/auth-errors.ts';
import { validateAuthForm } from '../src/features/auth/validation.ts';
import { createMockAuthService } from '../src/features/auth/mock-auth-service.ts';
import { createApiAuthService } from '../src/features/auth/api-auth-service.ts';

afterEach(() => vi.unstubAllGlobals());

const valid = {
  name: 'Minh Anh',
  email: 'student1@test.com',
  password: 'Test@1234',
  confirmPassword: 'Test@1234',
};

function createStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}
function createService() {
  return createMockAuthService({
    storage: createStorage(),
    delayMs: 0,
    isOnline: () => true,
  });
}

test('login only validates its own fields and accepts existing short passwords', () => {
  assert.deepEqual(
    validateAuthForm('login', {
      ...valid,
      name: '',
      password: 'old',
      confirmPassword: '',
    }),
    {},
  );
});
test('registration rejects blank names, malformed email and mismatched confirmation', () => {
  const errors = validateAuthForm('register', {
    ...valid,
    name: '   ',
    email: 'bad@',
    confirmPassword: 'other',
  });
  assert.deepEqual(Object.keys(errors).sort(), [
    'confirmPassword',
    'email',
    'name',
  ]);
});
test('registration requires a password and confirmation', () => {
  const errors = validateAuthForm('register', {
    ...valid,
    password: '',
    confirmPassword: '',
  });
  assert.ok(errors.password);
  assert.ok(errors.confirmPassword);
});
test("registration enforces the Auth contract's Unicode password boundaries", () => {
  for (const length of [7, 73]) {
    const password = '😀'.repeat(length);
    assert.ok(
      validateAuthForm('register', {
        ...valid,
        password,
        confirmPassword: password,
      }).password,
    );
  }
  for (const length of [8, 72]) {
    const password = '😀'.repeat(length);
    assert.deepEqual(
      validateAuthForm('register', {
        ...valid,
        password,
        confirmPassword: password,
      }),
      {},
    );
  }
});
test('registration enforces maximum name and email lengths', () => {
  assert.ok(
    validateAuthForm('register', { ...valid, name: '😀'.repeat(101) }).name,
  );
  assert.equal(
    validateAuthForm('register', { ...valid, name: '😀'.repeat(100) }).name,
    undefined,
  );
  assert.ok(
    validateAuthForm('register', {
      ...valid,
      email: `${'a'.repeat(250)}@test.com`,
    }).email,
  );
});
test('API sends cookie credentials and supports Headers instances', async () => {
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/api/v1/auth/me');
    assert.equal(options.credentials, 'include');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('X-Request-ID'), 'test-request');
    assert.equal(headers.get('Content-Type'), 'application/json');
    return Response.json({ data: { name: 'Minh Anh' } });
  });
  assert.deepEqual(
    await apiFetch('/api/v1/auth/me', {
      headers: new Headers({ 'X-Request-ID': 'test-request' }),
    }),
    { data: { name: 'Minh Anh' } },
  );
});
test("API preserves a caller's content type and handles 204", async () => {
  vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
    assert.equal(
      new Headers(options.headers).get('Content-Type'),
      'text/plain',
    );
    return new Response(null, { status: 204 });
  });
  assert.equal(
    await apiFetch('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
    }),
    undefined,
  );
});
test('API preserves nested business code and valid field errors', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json(
      {
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid input',
          details: [{ field: 'email', issue: 'invalid' }, null, { field: 1 }],
        },
      },
      { status: 400 },
    ),
  );
  await assert.rejects(apiFetch('/api/v1/auth/register'), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, 'VALIDATION_FAILED');
    assert.deepEqual(error.details, [{ field: 'email', issue: 'invalid' }]);
    return true;
  });
});
test('non-JSON proxy errors still produce an ApiError', async () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response('Bad gateway', { status: 502, statusText: 'Bad Gateway' }),
  );
  await assert.rejects(
    apiFetch('/api/v1/auth/me'),
    (error: unknown) => error instanceof ApiError && error.status === 502,
  );
});
test('auth messages depend on code, and cover throttling and connection errors', () => {
  assert.equal(
    getAuthErrorMessage(
      new ApiError(401, 'One wording', 'AUTH_INVALID_CREDENTIALS'),
    ),
    getAuthErrorMessage(
      new ApiError(401, 'Another wording', 'AUTH_INVALID_CREDENTIALS'),
    ),
  );
  assert.match(getAuthErrorMessage(new ApiError(429, '')), /quá nhiều lần/);
  assert.match(
    getAuthErrorMessage(new TypeError('Failed to fetch')),
    /kết nối/,
  );
});
test('API login consumes data directly without a redundant session request', async () => {
  const user = {
    id: '96ed2849-40c0-4e85-85d4-a85f3aff1f01',
    email: valid.email,
    name: valid.name,
    role: 'STUDENT',
  };
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    calls.push(url);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body as string), {
      email: valid.email,
      password: valid.password,
    });
    return Response.json({ data: user });
  });
  assert.deepEqual(await createApiAuthService().login(valid), user);
  assert.deepEqual(calls, ['/api/v1/auth/login']);
});
test('API registration sends only name/email/password and does not log in', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    calls.push(url);
    assert.deepEqual(JSON.parse(options.body as string), {
      name: valid.name,
      email: valid.email,
      password: valid.password,
    });
    return Response.json(
      {
        data: {
          id: '96ed2849-40c0-4e85-85d4-a85f3aff1f03',
          email: valid.email,
          name: valid.name,
          role: 'STUDENT',
        },
      },
      { status: 201 },
    );
  });
  await createApiAuthService().register({
    ...valid,
    role: 'ADMIN',
  } as typeof valid);
  assert.deepEqual(calls, ['/api/v1/auth/register']);
});
test('API me and logout treat expired sessions as signed out', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json(
      { error: { code: 'AUTH_SESSION_EXPIRED', message: 'Expired' } },
      { status: 401 },
    ),
  );
  const service = createApiAuthService();
  assert.equal(await service.me(), null);
  await assert.doesNotReject(service.logout());
});
test('API logout propagates infrastructure failures', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json(
      { error: { code: 'SERVICE_UNAVAILABLE', message: 'Unavailable' } },
      { status: 503 },
    ),
  );
  await assert.rejects(
    createApiAuthService().logout(),
    (error: unknown) => error instanceof ApiError && error.status === 503,
  );
});
test('mock login, session recovery and logout use the demo account', async () => {
  const storage = createStorage();
  const service = createMockAuthService({
    storage,
    delayMs: 0,
    isOnline: () => true,
  });
  assert.equal(await service.me(), null);
  const user = await service.login({
    email: ' STUDENT1@TEST.COM ',
    password: 'Test@1234',
  });
  assert.equal(user.role, 'STUDENT');
  const reloaded = createMockAuthService({
    storage,
    delayMs: 0,
    isOnline: () => true,
  });
  assert.equal((await reloaded.me())?.id, user.id);
  await service.logout();
  assert.equal(await service.me(), null);
});
test('mock rejects wrong credentials without authenticating', async () => {
  const service = createService();
  await assert.rejects(
    service.login({ email: valid.email, password: 'wrong' }),
    (error: unknown) =>
      error instanceof ApiError && error.code === 'AUTH_INVALID_CREDENTIALS',
  );
  assert.equal(await service.me(), null);
});
test('mock registration normalizes email, preserves password and does not auto-login', async () => {
  const service = createService();
  await service.register({
    name: ' Minh Anh ',
    email: ' NEW@TEST.COM ',
    password: '  pass  ',
  });
  assert.equal(await service.me(), null);
  await assert.rejects(
    service.login({ email: 'new@test.com', password: 'pass' }),
  );
  const user = await service.login({
    email: 'new@test.com',
    password: '  pass  ',
  });
  assert.equal(user.name, 'Minh Anh');
  assert.equal(user.role, 'STUDENT');
});
test('mock rejects duplicate emails and reports offline before creating accounts', async () => {
  const service = createService();
  await assert.rejects(
    service.register(valid),
    (error: unknown) => error instanceof ApiError && error.status === 409,
  );
  const offline = createMockAuthService({
    storage: createStorage(),
    delayMs: 0,
    isOnline: () => false,
  });
  await assert.rejects(offline.login(valid), TypeError);
});

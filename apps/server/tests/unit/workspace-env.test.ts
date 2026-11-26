import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { findWorkspaceEnv } from '../../src/core/config/workspace-env.js';

it('locates the root .env from source and built server entrypoints', () => {
  const expected = fileURLToPath(new URL('../../../../.env', import.meta.url));
  const source = new URL('../../src/index.ts', import.meta.url);
  const built = new URL('../../dist/apps/server/src/index.js', import.meta.url);
  expect(findWorkspaceEnv(source.href)).toBe(expected);
  expect(findWorkspaceEnv(built.href)).toBe(expected);
});

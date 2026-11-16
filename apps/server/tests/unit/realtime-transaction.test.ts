import { describe, expect, it } from 'vitest';
import { isRetryableTransactionError } from '../../src/core/db/transaction-error.js';

describe('Prisma transaction retry classification', () => {
  it('retries serialization and deadlock errors from ORM and raw locks', () => {
    expect(isRetryableTransactionError({ code: 'P2034' })).toBe(true);
    expect(
      isRetryableTransactionError({ code: 'P2010', meta: { code: '40001' } }),
    ).toBe(true);
    expect(
      isRetryableTransactionError({ code: 'P2010', meta: { code: '40P01' } }),
    ).toBe(true);
  });

  it('does not retry unrelated database or application errors', () => {
    expect(
      isRetryableTransactionError({ code: 'P2010', meta: { code: '23505' } }),
    ).toBe(false);
    expect(isRetryableTransactionError({ code: 'P2010' })).toBe(false);
    expect(isRetryableTransactionError(new Error('failed'))).toBe(false);
  });
});

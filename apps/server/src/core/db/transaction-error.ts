// Prisma reports ORM transaction conflicts as P2034, but a PostgreSQL
// serialization failure inside $queryRaw is wrapped as P2010 with SQLSTATE.
export function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error))
    return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010' || !('meta' in error)) return false;
  const meta = error.meta;
  if (typeof meta !== 'object' || meta === null || !('code' in meta))
    return false;
  return meta.code === '40001' || meta.code === '40P01';
}

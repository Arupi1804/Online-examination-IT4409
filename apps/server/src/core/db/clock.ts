import type { Prisma, PrismaClient } from '@prisma/client';

// Prisma cannot use a database expression as an update value. Read the
// PostgreSQL clock before setting exam and submission timestamps. This is
// clock_timestamp(), not now(): now() is fixed when the transaction starts,
// so a request that waited for a row lock past a deadline would still pass.
// Call it after taking the locks that guard the deadline check.
export async function databaseNow(
  client: Prisma.TransactionClient | PrismaClient,
): Promise<Date> {
  const [row] = await client.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  if (!row) throw new Error('PostgreSQL did not return its clock');
  return row.now;
}

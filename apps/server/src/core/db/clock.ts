import type { Prisma, PrismaClient } from '@prisma/client';

// Prisma cannot use a database expression as an update value. Read the
// PostgreSQL transaction clock before setting exam and submission timestamps.
export async function databaseNow(
  client: Prisma.TransactionClient | PrismaClient,
): Promise<Date> {
  const [row] = await client.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;
  if (!row) throw new Error('PostgreSQL did not return its clock');
  return row.now;
}

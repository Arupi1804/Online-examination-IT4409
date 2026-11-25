import type { PrismaClient } from '@prisma/client';

/**
 * Polls until a statement containing `sql` is blocked by a row lock. Pass
 * text unique to the statement under test: test files run in parallel.
 */
export async function waitForLockWait(prisma: PrismaClient, sql: string) {
  const pattern = `%${sql}%`;
  for (let i = 0; i < 100; i++) {
    const [row] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query ILIKE ${pattern}`;
    if (row && row.waiting > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const sessions = await prisma.$queryRaw<unknown[]>`
    SELECT state, wait_event_type, wait_event, left(query, 80) AS query
    FROM pg_stat_activity WHERE datname = current_database()`;
  throw new Error(
    `nothing waited for a lock in "${sql}": ${JSON.stringify(sessions)}`,
  );
}

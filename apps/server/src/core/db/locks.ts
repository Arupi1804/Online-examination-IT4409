import type { Prisma } from '@prisma/client';

// Prisma has no row-lock API. These locks preserve the transaction boundaries
// used by realtime submission while the data reads and writes use Prisma ORM.
export async function lockAttempt(
  tx: Prisma.TransactionClient,
  attemptId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
}

export async function lockExpiredExam(
  tx: Prisma.TransactionClient,
  examId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM exams
    WHERE id = ${examId}::uuid AND end_time + interval '5 seconds' < now()
    FOR UPDATE
  `;
  return rows.length > 0;
}

export async function lockOpenAttempts(
  tx: Prisma.TransactionClient,
  examId: string,
): Promise<void> {
  await tx.$queryRaw`
    SELECT id FROM attempts
    WHERE exam_id = ${examId}::uuid AND status = 'IN_PROGRESS'
    FOR UPDATE
  `;
}

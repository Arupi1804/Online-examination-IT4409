import { z } from 'zod';
import { ExamStatus } from '@online-exam/shared';

export const ListExamsQuery = z.object({
  // Upper bound keeps (page - 1) * pageSize inside Prisma's Int for `skip`.
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['createdAt:desc', 'createdAt:asc', 'startTime:desc'])
    .default('createdAt:desc'),
  status: ExamStatus.optional(),
});
export type ListExamsQuery = z.infer<typeof ListExamsQuery>;

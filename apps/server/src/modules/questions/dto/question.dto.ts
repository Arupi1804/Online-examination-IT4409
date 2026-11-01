import { z } from 'zod';
import { QuestionType } from '@online-exam/shared';

export const ListQuestionsQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['createdAt:desc', 'createdAt:asc', 'updatedAt:desc'])
    .default('createdAt:desc'),
  type: QuestionType.optional(),
  q: z.string().trim().max(200).optional(),
});
export type ListQuestionsQuery = z.infer<typeof ListQuestionsQuery>;

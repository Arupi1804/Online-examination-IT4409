import { z } from 'zod';
import { isoTime, selectedOptionsSchema } from '../take-exam/exam-model.ts';

const resultQuestionSchema = z
  .object({
    questionId: z.string().uuid(),
    type: z.enum(['SINGLE', 'MULTIPLE', 'TRUE_FALSE']),
    content: z.string(),
    explanation: z.string().nullable(),
    points: z.number().finite().nonnegative(),
    earnedPoints: z.number().finite().nonnegative(),
    selectedOptionIds: selectedOptionsSchema,
    options: z
      .array(
        z.object({
          id: z.string().uuid(),
          content: z.string(),
          isCorrect: z.boolean(),
        }),
      )
      .min(2),
  })
  .superRefine((question, ctx) => {
    const ids = new Set(question.options.map((option) => option.id));
    if (
      ids.size !== question.options.length ||
      question.earnedPoints > question.points ||
      question.selectedOptionIds.some((id) => !ids.has(id)) ||
      (question.type !== 'MULTIPLE' && question.selectedOptionIds.length > 1)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid result question' });
  });

export const attemptResultSchema = z
  .object({
    attemptId: z.string().uuid(),
    examId: z.string().uuid(),
    examTitle: z.string().min(1),
    status: z.enum(['SUBMITTED', 'AUTO_SUBMITTED', 'FORCE_SUBMITTED']),
    startedAt: isoTime,
    submittedAt: isoTime,
    score: z.number().finite().nonnegative(),
    maxScore: z.number().finite().nonnegative(),
    questions: z.array(resultQuestionSchema).nullable(),
  })
  .superRefine((result, ctx) => {
    if (
      result.score > result.maxScore ||
      Date.parse(result.submittedAt) < Date.parse(result.startedAt) ||
      (result.questions &&
        new Set(result.questions.map((question) => question.questionId))
          .size !== result.questions.length)
    ) {
      ctx.addIssue({ code: 'custom', message: 'Invalid result summary' });
    }
  });
export type AttemptResult = z.infer<typeof attemptResultSchema>;
export type ResultQuestion = z.infer<typeof resultQuestionSchema>;
export function resultLabel(question: ResultQuestion) {
  if (!question.selectedOptionIds.length) return 'Chưa trả lời';
  if (question.earnedPoints === question.points) return 'Đủ điểm';
  return question.earnedPoints > 0 ? 'Được một phần điểm' : 'Không được điểm';
}

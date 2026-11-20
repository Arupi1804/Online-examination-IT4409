import { z } from 'zod';
import type { AttemptPaper } from './exam-model.ts';

const uiSchema = z.object({
  currentQuestionId: z.string().uuid(),
  flaggedQuestionIds: z.array(z.string().uuid()),
});
const keyFor = (userId: string, attemptId: string) =>
  `oe:student:exam-ui:${userId}:${attemptId}`;
export function readExamUI(userId: string, paper: AttemptPaper) {
  const fallback = {
    currentQuestionId: paper.questions[0]!.questionId,
    flaggedQuestionIds: [] as string[],
  };
  try {
    const raw = sessionStorage.getItem(keyFor(userId, paper.attemptId));
    if (!raw) return fallback;
    const saved = uiSchema.parse(JSON.parse(raw));
    const knownIds = new Set(
      paper.questions.map((question) => question.questionId),
    );
    return {
      currentQuestionId: knownIds.has(saved.currentQuestionId)
        ? saved.currentQuestionId
        : fallback.currentQuestionId,
      flaggedQuestionIds: [...new Set(saved.flaggedQuestionIds)].filter((id) =>
        knownIds.has(id),
      ),
    };
  } catch {
    return fallback;
  }
}
export function saveExamUI(
  userId: string,
  attemptId: string,
  currentQuestionId: string,
  flaggedQuestionIds: string[],
) {
  try {
    sessionStorage.setItem(
      keyFor(userId, attemptId),
      JSON.stringify({ currentQuestionId, flaggedQuestionIds }),
    );
  } catch {
    /* Marking remains available in memory. */
  }
}

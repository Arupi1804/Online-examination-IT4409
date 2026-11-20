import { z } from 'zod';
import {
  selectedOptionsSchema,
  validSelection,
  type AttemptPaper,
} from './exam-model.ts';
import type { AnswerSnapshot } from './answer-autosaver.ts';

const draftSchema = z.object({
  attemptId: z.string().uuid(),
  examId: z.string().uuid(),
  answers: z.record(selectedOptionsSchema),
});
const keyFor = (userId: string, attemptId: string) =>
  `oe:student:pending:${userId}:${attemptId}`;

export function readAttemptDraft(
  userId: string,
  paper: AttemptPaper,
): Record<string, string[]> {
  if (paper.status !== 'IN_PROGRESS') return {};
  try {
    const raw = sessionStorage.getItem(keyFor(userId, paper.attemptId));
    if (!raw) return {};
    const draft = draftSchema.parse(JSON.parse(raw));
    if (draft.attemptId !== paper.attemptId || draft.examId !== paper.examId)
      return {};
    return Object.fromEntries(
      Object.entries(draft.answers).filter(([id, selected]) => {
        const question = paper.questions.find(
          (question) => question.questionId === id,
        );
        return question && validSelection(question, selected);
      }),
    );
  } catch {
    return {};
  }
}
export function saveAttemptDraft(
  userId: string,
  paper: AttemptPaper,
  snapshot: AnswerSnapshot,
): boolean {
  try {
    const answers = Object.fromEntries(
      Object.entries(snapshot.answers).filter(
        ([id]) => snapshot.statuses[id] !== 'saved',
      ),
    );
    if (Object.keys(answers).length)
      sessionStorage.setItem(
        keyFor(userId, paper.attemptId),
        JSON.stringify({
          attemptId: paper.attemptId,
          examId: paper.examId,
          answers,
        }),
      );
    else sessionStorage.removeItem(keyFor(userId, paper.attemptId));
    return true;
  } catch {
    return false;
  }
}
export function clearAttemptDraft(userId: string, attemptId: string) {
  try {
    sessionStorage.removeItem(keyFor(userId, attemptId));
  } catch {
    /* Storage may be blocked. */
  }
}

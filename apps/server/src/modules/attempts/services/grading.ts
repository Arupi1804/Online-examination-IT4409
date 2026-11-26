import type { Prisma } from '@prisma/client';

export type GradedQuestion = {
  questionId: string;
  /** exam_questions.points: at most two decimals. */
  points: number;
  correctOptionIds: readonly string[];
  selectedOptionIds: readonly string[];
};

/**
 * Grading rule of docs/api-contract.md, shared by REST submit and the
 * realtime auto/force submit: a question earns its full points only when the
 * selected options are exactly its correct options; otherwise 0. A question
 * without any correct option never scores. Sums are kept in hundredths so
 * decimal points add up exactly.
 */
export function gradeAttempt(questions: readonly GradedQuestion[]) {
  let score = 0;
  let maxScore = 0;
  const graded = questions.map((q) => {
    const points = Math.round(q.points * 100);
    const correct = new Set(q.correctOptionIds);
    const selected = new Set(q.selectedOptionIds);
    const right =
      correct.size > 0 &&
      correct.size === selected.size &&
      [...correct].every((id) => selected.has(id));
    maxScore += points;
    if (right) score += points;
    return { questionId: q.questionId, earnedPoints: right ? points / 100 : 0 };
  });
  return { score: score / 100, maxScore: maxScore / 100, questions: graded };
}

/**
 * Reads what gradeAttempt() needs inside the caller's transaction: points
 * and correct options of every exam question, plus the attempt's choices.
 * Shared by REST submit and realtime auto/force submit.
 */
export async function loadGradingQuestions(
  tx: Prisma.TransactionClient,
  attemptId: string,
  examId: string,
): Promise<GradedQuestion[]> {
  const questions = await tx.examQuestion.findMany({
    where: { examId },
    select: {
      questionId: true,
      points: true,
      question: {
        select: {
          options: { where: { isCorrect: true }, select: { id: true } },
        },
      },
      answers: {
        where: { attemptId },
        select: { selectedOptions: { select: { optionId: true } } },
      },
    },
  });
  return questions.map((question) => ({
    questionId: question.questionId,
    points: question.points.toNumber(),
    correctOptionIds: question.question.options.map((option) => option.id),
    selectedOptionIds: question.answers.flatMap((answer) =>
      answer.selectedOptions.map((selection) => selection.optionId),
    ),
  }));
}

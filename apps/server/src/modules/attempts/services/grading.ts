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

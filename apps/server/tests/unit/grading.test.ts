import { describe, expect, it } from 'vitest';
import {
  gradeAttempt,
  type GradedQuestion,
} from '../../src/modules/attempts/services/grading.js';

const q = (
  points: number,
  correctOptionIds: string[],
  selectedOptionIds: string[],
): GradedQuestion => ({
  questionId: `q-${correctOptionIds.join('')}-${selectedOptionIds.join('')}`,
  points,
  correctOptionIds,
  selectedOptionIds,
});

describe('gradeAttempt', () => {
  it('gives full points only for an exact match of the correct options', () => {
    const result = gradeAttempt([
      q(2, ['b'], ['b']), // single, right
      q(3, ['a', 'c'], ['c', 'a']), // multiple, right in any order
      q(3, ['a', 'c'], ['a']), // missing one: no partial credit
      q(3, ['a', 'c'], ['a', 'b', 'c']), // one extra wrong choice
      q(1, ['t'], []), // left blank
    ]);
    expect(result.score).toBe(5);
    expect(result.maxScore).toBe(12);
    expect(result.questions.map((x) => x.earnedPoints)).toEqual([
      2, 3, 0, 0, 0,
    ]);
  });

  it('never scores a question without correct options', () => {
    expect(gradeAttempt([q(1, [], [])])).toMatchObject({
      score: 0,
      maxScore: 1,
    });
  });

  it('adds decimal points exactly', () => {
    const result = gradeAttempt([
      q(0.1, ['a'], ['a']),
      q(0.2, ['a'], ['a']),
      q(0.33, ['a'], ['a']),
      q(0.33, ['a'], ['b']),
    ]);
    expect(result.score).toBe(0.63);
    expect(result.maxScore).toBe(0.96);
  });

  it('grades an empty exam as zero out of zero', () => {
    expect(gradeAttempt([])).toEqual({ score: 0, maxScore: 0, questions: [] });
  });
});

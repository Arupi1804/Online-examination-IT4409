import { expect, it } from 'vitest';
import {
  ExamInput,
  ProctorViolationPayload,
  RoomCode,
  SaveAnswerInput,
} from '../src/index.js';

it('rejects forbidden room-code characters from the PDF seed example', () => {
  expect(RoomCode.safeParse('DEMO01').success).toBe(false);
  expect(RoomCode.safeParse('K7M2QX').success).toBe(true);
});
it('rejects untrusted violation payloads with invalid IDs or timestamps', () => {
  expect(
    ProctorViolationPayload.safeParse({
      attemptId: 'fake',
      type: 'TAB_BLUR',
      at: 'yesterday',
    }).success,
  ).toBe(false);
});

const questionId = 'c1700d9e-af45-4774-b646-8df4a069c3ca';
const examFields = { title: 'Quiz', durationSec: 60 };

it('normalizes exam question UUIDs to lowercase', () => {
  const exam = ExamInput.parse({
    ...examFields,
    questions: [{ questionId: questionId.toUpperCase(), points: 1 }],
  });
  expect(exam.questions).toEqual([{ questionId, points: 1 }]);
});

it('rejects duplicate exam question UUIDs written in different cases', () => {
  const result = ExamInput.safeParse({
    ...examFields,
    questions: [
      { questionId, points: 1 },
      { questionId: questionId.toUpperCase(), points: 2 },
    ],
  });
  if (result.success) throw new Error('Duplicate questions were accepted');
  expect(result.error.issues).toEqual([
    {
      code: 'custom',
      path: ['questions'],
      message: 'A question can appear only once',
    },
  ]);
});

it('normalizes answer option UUIDs and rejects case-only duplicates', () => {
  const upper = questionId.toUpperCase();
  expect(SaveAnswerInput.parse({ selectedOptionIds: [upper] })).toEqual({
    selectedOptionIds: [questionId],
  });
  expect(SaveAnswerInput.parse({ selectedOptionIds: [] })).toEqual({
    selectedOptionIds: [],
  });
  const duplicate = SaveAnswerInput.safeParse({
    selectedOptionIds: [questionId, upper],
  });
  expect(duplicate.success).toBe(false);
  const tooMany = SaveAnswerInput.safeParse({
    selectedOptionIds: Array.from(
      { length: 11 },
      (_, i) => `${questionId.slice(0, -2)}${String(i).padStart(2, '0')}`,
    ),
  });
  expect(tooMany.success).toBe(false);
});

import { expect, it } from 'vitest';
import { QuestionInput } from '../src/index.js';

const opts = (...correct: boolean[]) =>
  correct.map((isCorrect, i) => ({ content: `Option ${i}`, isCorrect }));
const valid = (type: string, options: unknown) =>
  QuestionInput.safeParse({ type, content: 'Q?', options }).success;

it('requires exactly one correct option for SINGLE', () => {
  expect(valid('SINGLE', opts(true, false, false))).toBe(true);
  expect(valid('SINGLE', opts(true, true, false))).toBe(false);
  expect(valid('SINGLE', opts(false, false))).toBe(false);
});
it('requires at least one correct option for MULTIPLE', () => {
  expect(valid('MULTIPLE', opts(true, true, false))).toBe(true);
  expect(valid('MULTIPLE', opts(false, false, false))).toBe(false);
});
it('requires two options with one correct for TRUE_FALSE', () => {
  expect(valid('TRUE_FALSE', opts(true, false))).toBe(true);
  expect(valid('TRUE_FALSE', opts(true, false, false))).toBe(false);
});
it('trims text and rejects blank content or too few options', () => {
  const parsed = QuestionInput.parse({
    type: 'SINGLE',
    content: '  Q?  ',
    options: opts(true, false),
  });
  expect(parsed.content).toBe('Q?');
  expect(valid('SINGLE', opts(true))).toBe(false);
  expect(
    QuestionInput.safeParse({
      type: 'SINGLE',
      content: ' ',
      options: opts(true, false),
    }).success,
  ).toBe(false);
});

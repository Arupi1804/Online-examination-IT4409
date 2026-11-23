import { expect, it } from 'vitest';
import { ProctorViolationPayload, RoomCode } from '../src/index.js';

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

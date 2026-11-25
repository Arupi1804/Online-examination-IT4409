/* KIỂM THỬ WORKER KHÔI PHỤC KỲ THI QUÁ HẠN */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RealtimeWorker } from '../../src/modules/realtime/jobs/worker.js';
import type { RealtimeService } from '../../src/modules/realtime/services/service.js';
import type { RealtimeGateway } from '../../src/modules/realtime/handlers/gateway.js';
import type { Exam } from '../../src/modules/realtime/services/repository.js';

// Case kiểm chứng deadline quá hạn được tự động chốt đúng một lần
test('recovered overdue exam submits once and emits ended after commit', async () => {
  const examId = '33333333-3333-4333-8333-333333333333';
  const attemptId = '44444444-4444-4444-8444-444444444444';
  const exam: Exam = {
    id: examId,
    owner_id: '11111111-1111-4111-8111-111111111111',
    room_code: 'ABC234',
    status: 'RUNNING',
    start_time: new Date(Date.now() - 120_000),
    end_time: new Date(Date.now() - 20_000),
    duration_sec: 100,
  };
  const emitted: string[] = [];
  let finished = false;
  const service = {
    db: {
      runningExams: async () => (finished ? [] : [exam]),
      unfinishedEndedExams: async () => [],
      exam: async () => exam,
    },
    cache: { offlineCandidates: async () => [] },
    finishExpired: async () => {
      if (finished) return null;
      finished = true;
      return {
        exam: { ...exam, status: 'ENDED' },
        ended: true,
        submissions: [
          {
            examId,
            attemptId,
            userId: '22222222-2222-4222-8222-222222222222',
            status: 'AUTO_SUBMITTED',
            submittedAt: new Date().toISOString(),
          },
        ],
      };
    },
  } as unknown as RealtimeService;
  const gateway = {
    namespace: { to: () => ({ emit: (event: string) => emitted.push(event) }) },
    emitSubmitted: () => emitted.push('attempt:submitted'),
    emitStudentUpdate: async () => {
      emitted.push('monitor:student_update');
    },
  } as unknown as RealtimeGateway;
  const worker = new RealtimeWorker(service, gateway);
  await worker.tick();
  await worker.tick();
  worker.stop();
  assert.deepEqual(emitted, [
    'attempt:submitted',
    'monitor:student_update',
    'exam:ended',
  ]);
});

test('a failed exam does not stop startup recovery for other exams', async () => {
  const failedId = '33333333-3333-4333-8333-333333333333';
  const recoveredId = '55555555-5555-4555-8555-555555555555';
  const overdue = new Date(Date.now() - 20_000);
  const exams = [failedId, recoveredId].map(
    (id): Exam => ({
      id,
      owner_id: '11111111-1111-4111-8111-111111111111',
      room_code: 'ABC234',
      status: 'RUNNING',
      start_time: new Date(Date.now() - 120_000),
      end_time: overdue,
      duration_sec: 100,
    }),
  );
  const finished: string[] = [];
  const logged: { examId: string; error: unknown }[] = [];
  const emitted: string[] = [];
  const failure = new Error('database failure');
  const service = {
    db: {
      runningExams: async () => exams,
      unfinishedEndedExams: async () => [],
    },
    finishExpired: async (examId: string) => {
      finished.push(examId);
      if (examId === failedId) throw failure;
      return {
        exam: { ...exams[1], status: 'ENDED' },
        submissions: [],
        ended: true,
      };
    },
  } as unknown as RealtimeService;
  const gateway = {
    namespace: { to: () => ({ emit: (event: string) => emitted.push(event) }) },
    setScheduleListener: () => {},
  } as unknown as RealtimeGateway;
  const worker = new RealtimeWorker(service, gateway, {
    error: (_message, context: { examId: string; error: unknown }) =>
      logged.push(context),
  });
  try {
    await worker.start();
    assert.deepEqual(finished, [failedId, recoveredId]);
    assert.deepEqual(logged, [{ examId: failedId, error: failure }]);
    assert.deepEqual(emitted, ['exam:ended']);
  } finally {
    worker.stop();
  }
});

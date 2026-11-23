import { z } from 'zod';
import { apiFetch } from '../../../services/api.ts';
import { connectAttempt } from '../../../socket/attempt.ts';
import {
  attemptPaperSchema,
  savedAnswerSchema,
  selectedOptionsSchema,
  submissionSchema,
  sameSelection,
  type ExamService,
  type LoadedAttempt,
} from './exam-model.ts';
import { ExamError } from './exam-errors.ts';
import { attemptResultSchema } from '../results/result-model.ts';

export function createApiExamService(): ExamService {
  const starting = new Map<string, Promise<LoadedAttempt>>();
  return {
    start(userId, examId) {
      const key = `${userId}:${examId}`;
      const existing = starting.get(key);
      if (existing) return existing;
      const request = (async () => {
        z.string().uuid().parse(examId);
        const sentAt = performance.now();
        const response = await apiFetch<unknown>(
          `/api/v1/exams/${examId}/attempts`,
          { method: 'POST', signal: AbortSignal.timeout(12000) },
        );
        const receivedAt = performance.now();
        const { data: paper } = z
          .object({ data: attemptPaperSchema })
          .parse(response);
        if (paper.examId !== examId) throw new ExamError('RESPONSE_MISMATCH');
        return {
          paper,
          clock: {
            examId,
            status: 'RUNNING' as const,
            endTime: paper.endTime,
            serverTime: paper.serverTime,
            receivedAt,
            roundTripMs: receivedAt - sentAt,
          },
        };
      })();
      starting.set(key, request);
      void request
        .finally(() => {
          if (starting.get(key) === request) starting.delete(key);
        })
        .catch(() => undefined);
      return request;
    },
    async save(attemptId, questionId, selected) {
      z.string().uuid().parse(attemptId);
      z.string().uuid().parse(questionId);
      const selectedOptionIds = selectedOptionsSchema.parse(selected);
      const { data } = z.object({ data: savedAnswerSchema }).parse(
        await apiFetch<unknown>(
          `/api/v1/attempts/${attemptId}/answers/${questionId}`,
          {
            method: 'PUT',
            body: JSON.stringify({ selectedOptionIds }),
            signal: AbortSignal.timeout(12000),
          },
        ),
      );
      if (
        data.questionId !== questionId ||
        !sameSelection(data.selectedOptionIds, selectedOptionIds)
      )
        throw new ExamError('RESPONSE_MISMATCH');
      return data;
    },
    async submit(attemptId) {
      z.string().uuid().parse(attemptId);
      const { data } = z.object({ data: submissionSchema }).parse(
        await apiFetch<unknown>(`/api/v1/attempts/${attemptId}/submit`, {
          method: 'POST',
          signal: AbortSignal.timeout(12000),
        }),
      );
      if (data.attemptId !== attemptId)
        throw new ExamError('RESPONSE_MISMATCH');
      return data;
    },
    watch: connectAttempt,
    async result(_userId, examId, attemptId) {
      z.string().uuid().parse(examId);
      z.string().uuid().parse(attemptId);
      const { data } = z.object({ data: attemptResultSchema }).parse(
        await apiFetch<unknown>(`/api/v1/attempts/${attemptId}/result`, {
          signal: AbortSignal.timeout(12000),
        }),
      );
      if (data.attemptId !== attemptId || data.examId !== examId)
        throw new ExamError('RESPONSE_MISMATCH');
      return data;
    },
  };
}

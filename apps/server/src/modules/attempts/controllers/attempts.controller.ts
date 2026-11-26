import { Router, type Request, type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ERROR_CODES, SaveAnswerInput } from '@online-exam/shared';
import { handle } from '../../../core/http/error-handler.js';
import { HttpError } from '../../../core/errors/http-error.js';
import type { Submitted } from '../../../shared/realtime.js';
import {
  getAttemptResult,
  saveAnswer,
  startAttempt,
  submitAttempt,
} from '../services/attempt.service.js';

/** Realtime hooks, called only after the transaction has committed. */
export type AttemptEvents = {
  answerSaved?(attemptId: string): unknown;
  submitted?(submission: Submitted): unknown;
};

const Id = z
  .string()
  .uuid()
  .transform((id) => id.toLowerCase());

function param(req: Request, name: string, what: string) {
  const id = Id.safeParse(req.params[name]);
  if (!id.success) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, `${what} not found`);
  }
  return id.data;
}

// A failed WebSocket push must not fail a request whose data is saved.
function notify(fn: () => unknown, logger: Pick<Console, 'error'>) {
  void Promise.resolve()
    .then(fn)
    .catch((error) => logger.error('Realtime notification failed', error));
}

/**
 * Mounted on the API root (paths under /exams and /attempts). `roles` are
 * `sessions.requireRoles('STUDENT')` and
 * `sessions.requireRoles('STUDENT', 'TEACHER')`: teachers only read results.
 */
export function createAttemptsRouter(
  prisma: PrismaClient,
  roles: { student: RequestHandler; studentOrTeacher: RequestHandler },
  events: AttemptEvents = {},
  logger: Pick<Console, 'error'> = console,
) {
  const router = Router();
  const userId = (req: Request) => req.principal!.id;

  router.post(
    '/exams/:examId/attempts',
    roles.student,
    handle(async (req, res) => {
      const examId = param(req, 'examId', 'Exam');
      const { created, paper } = await startAttempt(
        prisma,
        userId(req),
        examId,
      );
      res.status(created ? 201 : 200).json({ data: paper });
    }),
  );
  router.put(
    '/attempts/:attemptId/answers/:questionId',
    roles.student,
    handle(async (req, res) => {
      const attemptId = param(req, 'attemptId', 'Attempt');
      const questionId = param(req, 'questionId', 'Question');
      const { selectedOptionIds } = SaveAnswerInput.parse(req.body);
      const saved = await saveAnswer(
        prisma,
        userId(req),
        attemptId,
        questionId,
        selectedOptionIds,
      );
      res.json({ data: saved });
      notify(() => events.answerSaved?.(attemptId), logger);
    }),
  );
  router.post(
    '/attempts/:attemptId/submit',
    roles.student,
    handle(async (req, res) => {
      const attemptId = param(req, 'attemptId', 'Attempt');
      const { submitted, summary } = await submitAttempt(
        prisma,
        userId(req),
        attemptId,
      );
      res.json({ data: summary });
      notify(() => events.submitted?.(submitted), logger);
    }),
  );
  router.get(
    '/attempts/:attemptId/result',
    roles.studentOrTeacher,
    handle(async (req, res) => {
      const attemptId = param(req, 'attemptId', 'Attempt');
      const viewer = { id: req.principal!.id, role: req.principal!.role };
      res.json({ data: await getAttemptResult(prisma, viewer, attemptId) });
    }),
  );
  return router;
}

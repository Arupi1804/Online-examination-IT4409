import { Router, type Request, type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ERROR_CODES, QuestionInput } from '@online-exam/shared';
import { handle } from '../../../core/http/error-handler.js';
import { HttpError } from '../../../core/errors/http-error.js';
import { ListQuestionsQuery } from '../dto/question.dto.js';
import {
  createQuestion,
  deleteQuestion,
  getQuestion,
  listQuestions,
  updateQuestion,
} from '../services/question.service.js';

function questionId(req: Request) {
  const id = z.string().uuid().safeParse(req.params.questionId);
  if (!id.success) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Question not found');
  }
  return id.data;
}

/** Mounted at /questions; `requireTeacher` is `sessions.requireRoles('TEACHER')`. */
export function createQuestionsRouter(
  prisma: PrismaClient,
  requireTeacher: RequestHandler,
) {
  const router = Router();
  router.use(requireTeacher);
  const ownerId = (req: Request) => req.principal!.id;

  router.get(
    '/',
    handle(async (req, res) => {
      const query = ListQuestionsQuery.parse(req.query);
      res.json(await listQuestions(prisma, ownerId(req), query));
    }),
  );
  router.post(
    '/',
    handle(async (req, res) => {
      const input = QuestionInput.parse(req.body);
      res
        .status(201)
        .json({ data: await createQuestion(prisma, ownerId(req), input) });
    }),
  );
  router.get(
    '/:questionId',
    handle(async (req, res) => {
      res.json({
        data: await getQuestion(prisma, ownerId(req), questionId(req)),
      });
    }),
  );
  router.put(
    '/:questionId',
    handle(async (req, res) => {
      const id = questionId(req);
      const input = QuestionInput.parse(req.body);
      res.json({
        data: await updateQuestion(prisma, ownerId(req), id, input),
      });
    }),
  );
  router.delete(
    '/:questionId',
    handle(async (req, res) => {
      await deleteQuestion(prisma, ownerId(req), questionId(req));
      res.status(204).end();
    }),
  );
  return router;
}

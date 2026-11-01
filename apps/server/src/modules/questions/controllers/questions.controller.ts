import { Router, type Request } from 'express';
import { z } from 'zod';
import { ERROR_CODES, QuestionInput } from '@online-exam/shared';
import { handle } from '../../../core/http/error-handler.js';
import { HttpError } from '../../../core/errors/http-error.js';
import { currentUser, requireRole } from '../../../core/middleware/auth.js';
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

export const questionsRouter = Router();
questionsRouter.use(requireRole('TEACHER'));

questionsRouter.get(
  '/',
  handle(async (req, res) => {
    const query = ListQuestionsQuery.parse(req.query);
    res.json(await listQuestions(currentUser(req).id, query));
  }),
);
questionsRouter.post(
  '/',
  handle(async (req, res) => {
    const input = QuestionInput.parse(req.body);
    res
      .status(201)
      .json({ data: await createQuestion(currentUser(req).id, input) });
  }),
);
questionsRouter.get(
  '/:questionId',
  handle(async (req, res) => {
    res.json({ data: await getQuestion(currentUser(req).id, questionId(req)) });
  }),
);
questionsRouter.put(
  '/:questionId',
  handle(async (req, res) => {
    const id = questionId(req);
    const input = QuestionInput.parse(req.body);
    res.json({ data: await updateQuestion(currentUser(req).id, id, input) });
  }),
);
questionsRouter.delete(
  '/:questionId',
  handle(async (req, res) => {
    await deleteQuestion(currentUser(req).id, questionId(req));
    res.status(204).end();
  }),
);

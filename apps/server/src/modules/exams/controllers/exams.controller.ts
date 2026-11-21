import { Router, type Request, type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { ERROR_CODES, ExamInput, JoinExamInput } from '@online-exam/shared';
import { handle } from '../../../core/http/error-handler.js';
import { HttpError } from '../../../core/errors/http-error.js';
import { ListExamsQuery } from '../dto/exam.dto.js';
import {
  createExam,
  deleteExam,
  getExam,
  joinExam,
  listExams,
  publishExam,
  updateExam,
} from '../services/exam.service.js';

function examId(req: Request) {
  const id = z.string().uuid().safeParse(req.params.examId);
  if (!id.success) {
    throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Exam not found');
  }
  return id.data;
}

/**
 * Mounted at /exams. `roles` are `sessions.requireRoles('TEACHER')` and
 * `sessions.requireRoles('STUDENT')`: only joining is for students.
 */
export function createExamsRouter(
  prisma: PrismaClient,
  roles: { teacher: RequestHandler; student: RequestHandler },
) {
  const router = Router();
  const userId = (req: Request) => req.principal!.id;

  router.post(
    '/join',
    roles.student,
    handle(async (req, res) => {
      const { roomCode } = JoinExamInput.parse(req.body);
      res.json({ data: await joinExam(prisma, userId(req), roomCode) });
    }),
  );
  router.get(
    '/',
    roles.teacher,
    handle(async (req, res) => {
      const query = ListExamsQuery.parse(req.query);
      res.json(await listExams(prisma, userId(req), query));
    }),
  );
  router.post(
    '/',
    roles.teacher,
    handle(async (req, res) => {
      const input = ExamInput.parse(req.body);
      res
        .status(201)
        .json({ data: await createExam(prisma, userId(req), input) });
    }),
  );
  router.get(
    '/:examId',
    roles.teacher,
    handle(async (req, res) => {
      res.json({ data: await getExam(prisma, userId(req), examId(req)) });
    }),
  );
  router.put(
    '/:examId',
    roles.teacher,
    handle(async (req, res) => {
      const id = examId(req);
      const input = ExamInput.parse(req.body);
      res.json({ data: await updateExam(prisma, userId(req), id, input) });
    }),
  );
  router.delete(
    '/:examId',
    roles.teacher,
    handle(async (req, res) => {
      await deleteExam(prisma, userId(req), examId(req));
      res.status(204).end();
    }),
  );
  router.post(
    '/:examId/publish',
    roles.teacher,
    handle(async (req, res) => {
      res.json({ data: await publishExam(prisma, userId(req), examId(req)) });
    }),
  );
  return router;
}

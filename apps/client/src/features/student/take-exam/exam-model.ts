import { z } from 'zod';
import { ViolationType } from '@online-exam/shared';
import type { AttemptResult } from '../results/result-model.ts';

const id = z.string().uuid();
export const isoTime = z.string().datetime({ offset: true });
export const attemptStatusSchema = z.enum([
  'IN_PROGRESS',
  'SUBMITTED',
  'AUTO_SUBMITTED',
  'FORCE_SUBMITTED',
]);
export const selectedOptionsSchema = z
  .array(id)
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length);
export const savedAnswerSchema = z.object({
  questionId: id,
  selectedOptionIds: selectedOptionsSchema,
  updatedAt: isoTime,
});
export const paperQuestionSchema = z.object({
  questionId: id,
  type: z.enum(['SINGLE', 'MULTIPLE', 'TRUE_FALSE']),
  content: z.string(),
  points: z.number().nonnegative(),
  options: z
    .array(z.object({ id, content: z.string() }))
    .min(2)
    .max(10),
});
export const attemptPaperSchema = z
  .object({
    attemptId: id,
    examId: id,
    status: attemptStatusSchema,
    startedAt: isoTime,
    endTime: isoTime,
    serverTime: isoTime,
    questions: z.array(paperQuestionSchema).min(1),
    answers: z.array(savedAnswerSchema),
  })
  .superRefine((paper, ctx) => {
    const questions = new Map(
      paper.questions.map((question) => [question.questionId, question]),
    );
    if (
      questions.size !== paper.questions.length ||
      new Set(paper.answers.map((answer) => answer.questionId)).size !==
        paper.answers.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate question or answer' });
    }
    for (const question of paper.questions) {
      if (
        new Set(question.options.map((option) => option.id)).size !==
        question.options.length
      )
        ctx.addIssue({ code: 'custom', message: 'Duplicate option' });
    }
    for (const answer of paper.answers) {
      const question = questions.get(answer.questionId);
      if (!question || !validSelection(question, answer.selectedOptionIds))
        ctx.addIssue({
          code: 'custom',
          message: 'Answer does not belong to this paper',
        });
    }
  });

export const submissionSchema = z.object({
  attemptId: id,
  examId: id,
  status: z.enum(['SUBMITTED', 'AUTO_SUBMITTED', 'FORCE_SUBMITTED']),
  submittedAt: isoTime,
});
export type PaperQuestion = z.infer<typeof paperQuestionSchema>;
export type AttemptPaper = z.infer<typeof attemptPaperSchema>;
export type SavedAnswer = z.infer<typeof savedAnswerSchema>;
export type Submission = z.infer<typeof submissionSchema>;
export const recoveredAttemptSchema = z
  .object({
    attemptId: id,
    examId: id,
    status: attemptStatusSchema,
    submittedAt: isoTime.nullable(),
    answers: z.array(
      z.object({ questionId: id, optionIds: selectedOptionsSchema }),
    ),
    clock: z.object({
      examId: id,
      status: z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'ENDED']),
      startTime: isoTime.nullable(),
      endTime: isoTime.nullable(),
      serverTime: isoTime,
    }),
  })
  .superRefine((state, ctx) => {
    if (
      state.clock.examId !== state.examId ||
      (state.status !== 'IN_PROGRESS' && !state.submittedAt) ||
      (state.status === 'IN_PROGRESS' &&
        (!state.clock.endTime ||
          !state.clock.startTime ||
          !['RUNNING', 'ENDED'].includes(state.clock.status))) ||
      new Set(state.answers.map((answer) => answer.questionId)).size !==
        state.answers.length
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid recovered state' });
  });
export type RecoveredAttempt = z.infer<typeof recoveredAttemptSchema>;
export type ProctorEvent = z.infer<typeof ViolationType>;
export interface ExamDisconnection {
  sequence: number;
  clientAt: string;
}
export interface ExamConnection {
  disconnect(): void;
  report(type: ProctorEvent, clientAt: string): Promise<void>;
}
export interface ClockSample {
  examId: string;
  status: 'RUNNING' | 'ENDED';
  endTime: string;
  serverTime: string;
  receivedAt: number;
  roundTripMs: number;
}
export interface LoadedAttempt {
  paper: AttemptPaper;
  clock: ClockSample;
}
export interface ExamCallbacks {
  onRecovered(state: RecoveredAttempt): void;
  onClock(clock: ClockSample): void;
  onSubmitted(submission: Submission): void;
  onConnection(connected: boolean): void;
  onDisconnect?(): void;
  onError(error: unknown): void;
}
export interface ExamService {
  start(userId: string, examId: string): Promise<LoadedAttempt>;
  save(
    attemptId: string,
    questionId: string,
    selectedOptionIds: string[],
  ): Promise<SavedAnswer>;
  submit(attemptId: string): Promise<Submission>;
  watch(paper: AttemptPaper, callbacks: ExamCallbacks): ExamConnection;
  result(
    userId: string,
    examId: string,
    attemptId: string,
  ): Promise<AttemptResult>;
}

export function validSelection(question: PaperQuestion, selected: string[]) {
  return (
    selected.length <= (question.type === 'MULTIPLE' ? 10 : 1) &&
    new Set(selected).size === selected.length &&
    selected.every((optionId) =>
      question.options.some((option) => option.id === optionId),
    )
  );
}
export function sameSelection(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

// Use elapsed monotonic time; changes to the student's system clock cannot
// extend the exam. Half the request RTT approximates response transit time.
export function remainingSeconds(
  clock: ClockSample,
  monotonicNow = performance.now(),
) {
  const serverNow =
    Date.parse(clock.serverTime) +
    Math.max(0, clock.roundTripMs) / 2 +
    Math.max(0, monotonicNow - clock.receivedAt);
  return Math.max(0, Math.ceil((Date.parse(clock.endTime) - serverNow) / 1000));
}
export function formatRemaining(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const tail = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return hours ? `${String(hours).padStart(2, '0')}:${tail}` : tail;
}

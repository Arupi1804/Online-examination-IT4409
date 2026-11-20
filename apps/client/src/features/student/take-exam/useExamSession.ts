import { useEffect, useRef, useState } from 'react';
import { AnswerAutosaver, type AnswerSnapshot } from './answer-autosaver';
import { ExamError, hasExamErrorCode, isExamAuthError } from './exam-errors';
import {
  remainingSeconds,
  type ClockSample,
  type LoadedAttempt,
  type Submission,
} from './exam-model';
import { examService } from './exam-service';

interface Runtime {
  active: boolean;
  controller: AnswerAutosaver;
  disconnect?: () => void;
  reconnect(): void;
}
export interface Receipt {
  submittedAt: string | null;
}

export function useExamSession(loaded: LoadedAttempt) {
  const { paper } = loaded;
  const [answers, setAnswers] = useState<AnswerSnapshot>(() => ({
    answers: Object.fromEntries(
      paper.questions.map((question) => [
        question.questionId,
        paper.answers.find(
          (answer) => answer.questionId === question.questionId,
        )?.selectedOptionIds ?? [],
      ]),
    ),
    statuses: Object.fromEntries(
      paper.questions.map((question) => [
        question.questionId,
        'saved' as const,
      ]),
    ),
    pendingCount: 0,
    failedCount: 0,
  }));
  const [clock, setClock] = useState(loaded.clock);
  const clockRef = useRef(clock);
  const [connected, setConnected] = useState(false);
  const [connectionError, setConnectionError] = useState<unknown>(null);
  const [fatalError, setFatalError] = useState<unknown>(null);
  const [closed, setClosed] = useState(false);
  const closedRef = useRef(false);
  const [receipt, setReceipt] = useState<Receipt | null>(
    paper.status === 'IN_PROGRESS' ? null : { submittedAt: null },
  );
  const terminal = useRef(paper.status !== 'IN_PROGRESS');
  const fatal = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const runtime = useRef<Runtime | null>(null);
  const finishRef = useRef<(submission?: Submission) => void>(() => undefined);

  useEffect(() => {
    if (paper.status !== 'IN_PROGRESS') return;
    let active = true;
    terminal.current = false;
    const controller = new AnswerAutosaver({
      paper,
      save: (questionId, selected) =>
        examService.save(paper.attemptId, questionId, selected),
      canSave: () =>
        active &&
        !terminal.current &&
        !fatal.current &&
        !closedRef.current &&
        remainingSeconds(clockRef.current) > 0,
      onChange: (snapshot) => {
        if (active && !terminal.current) setAnswers(snapshot);
      },
      onError: handleError,
    });
    const session: Runtime = { active: true, controller, reconnect: connect };
    runtime.current = session;
    setAnswers(controller.snapshot());

    function finish(submission?: Submission) {
      if (!active || terminal.current) return;
      terminal.current = true;
      controller.dispose();
      session.disconnect?.();
      setReceipt({ submittedAt: submission?.submittedAt ?? null });
    }
    finishRef.current = finish;
    function handleError(error: unknown) {
      if (!active) return;
      if (hasExamErrorCode(error, 'ATTEMPT_ALREADY_SUBMITTED')) finish();
      else if (isExamAuthError(error) || hasExamErrorCode(error, 'FORBIDDEN')) {
        fatal.current = true;
        setFatalError(error);
      } else if (
        hasExamErrorCode(error, 'EXAM_ENDED') ||
        hasExamErrorCode(error, 'SUBMIT_TOO_LATE')
      ) {
        closedRef.current = true;
        setClosed(true);
      }
    }
    function syncClock(incoming: ClockSample) {
      if (
        !active ||
        incoming.examId !== paper.examId ||
        Date.parse(incoming.serverTime) <
          Date.parse(clockRef.current.serverTime)
      )
        return;
      if (clockRef.current.status === 'ENDED' && incoming.status !== 'ENDED')
        return;
      clockRef.current = incoming;
      setClock(incoming);
      if (incoming.status === 'ENDED') {
        closedRef.current = true;
        setClosed(true);
      }
    }
    function connect() {
      if (!active || terminal.current) return;
      session.disconnect?.();
      setConnectionError(null);
      setConnected(false);
      session.disconnect = examService.watch(paper, {
        onClock: syncClock,
        onSubmitted: finish,
        onConnection(value) {
          if (active) {
            setConnected(value);
            if (value) setConnectionError(null);
          }
        },
        onError(error) {
          if (active) {
            setConnectionError(error);
            handleError(error);
          }
        },
      });
    }
    connect();
    return () => {
      active = false;
      session.active = false;
      controller.dispose();
      session.disconnect?.();
      if (runtime.current === session) runtime.current = null;
    };
  }, [paper]);

  useEffect(() => {
    if (receipt || (!answers.pendingCount && !answers.failedCount)) return;
    function beforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [answers.pendingCount, answers.failedCount, receipt]);

  async function submit() {
    const session = runtime.current;
    if (
      !session ||
      submittingRef.current ||
      terminal.current ||
      fatal.current ||
      closedRef.current ||
      remainingSeconds(clockRef.current) === 0
    )
      return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (!(await session.controller.flush()))
        throw new ExamError('ANSWERS_NOT_SAVED');
      if (!session.active || terminal.current) return;
      if (remainingSeconds(clockRef.current) === 0 || closedRef.current)
        throw new ExamError('EXAM_ENDED');
      const submitted = await examService.submit(paper.attemptId);
      if (submitted.examId !== paper.examId)
        throw new ExamError('RESPONSE_MISMATCH');
      if (session.active) finishRef.current(submitted);
    } catch (error) {
      if (session.active && !terminal.current) {
        if (hasExamErrorCode(error, 'ATTEMPT_ALREADY_SUBMITTED'))
          finishRef.current();
        else {
          setSubmitError(error);
          if (isExamAuthError(error) || hasExamErrorCode(error, 'FORBIDDEN')) {
            fatal.current = true;
            setFatalError(error);
          }
          if (
            hasExamErrorCode(error, 'EXAM_ENDED') ||
            hasExamErrorCode(error, 'SUBMIT_TOO_LATE')
          ) {
            closedRef.current = true;
            setClosed(true);
          }
        }
      }
    } finally {
      submittingRef.current = false;
      if (session.active) setSubmitting(false);
    }
  }
  return {
    ...answers,
    clock,
    connected,
    connectionError,
    fatalError,
    closed,
    receipt,
    submitting,
    submitError,
    choose: (questionId: string, selected: string[]) => {
      if (!submittingRef.current)
        runtime.current?.controller.choose(questionId, selected);
    },
    retrySaving: () => runtime.current?.controller.retryFailed(),
    reconnect: () => runtime.current?.reconnect(),
    submit,
    flush: () =>
      terminal.current
        ? Promise.resolve(true)
        : (runtime.current?.controller.flush() ?? Promise.resolve(false)),
  };
}

export function useCountdown(clock: ClockSample) {
  const [remaining, setRemaining] = useState(() => remainingSeconds(clock));
  useEffect(() => {
    const tick = () => setRemaining(remainingSeconds(clock));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [clock]);
  return remaining;
}

import { useEffect, useRef, useState } from 'react';
import { AnswerAutosaver, type AnswerSnapshot } from './answer-autosaver';
import { ExamError, hasExamErrorCode, isExamAuthError } from './exam-errors';
import {
  remainingSeconds,
  type ClockSample,
  type LoadedAttempt,
  type Submission,
  type ExamConnection,
  type ProctorEvent,
} from './exam-model';
import { examService } from './exam-service';
import {
  clearAttemptDraft,
  readAttemptDraft,
  saveAttemptDraft,
} from './attempt-draft';

interface Runtime {
  active: boolean;
  controller: AnswerAutosaver;
  connection?: ExamConnection;
  reconnect(): void;
}
export interface Receipt {
  submittedAt: string | null;
}

export function useExamSession(loaded: LoadedAttempt, userId: string) {
  const { paper } = loaded;
  const [draft] = useState(() => readAttemptDraft(userId, paper));
  const [answers, setAnswers] = useState<AnswerSnapshot>(() => ({
    answers: Object.fromEntries(
      paper.questions.map((question) => [
        question.questionId,
        draft[question.questionId] ??
          paper.answers.find(
            (answer) => answer.questionId === question.questionId,
          )?.selectedOptionIds ??
          [],
      ]),
    ),
    statuses: Object.fromEntries(
      paper.questions.map((question) => [
        question.questionId,
        draft[question.questionId] ? ('queued' as const) : ('saved' as const),
      ]),
    ),
    pendingCount: Object.keys(draft).length,
    failedCount: 0,
    queuedCount: Object.keys(draft).length,
  }));
  const [clock, setClock] = useState(loaded.clock);
  const clockRef = useRef(clock);
  const [connected, setConnected] = useState(false);
  const connectedRef = useRef(false);
  const [browserOnline, setBrowserOnline] = useState(
    navigator.onLine !== false,
  );
  const [draftStored, setDraftStored] = useState(true);
  const persistDraft = useRef(true);
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
    if (paper.status !== 'IN_PROGRESS') {
      clearAttemptDraft(userId, paper.attemptId);
      return;
    }
    let active = true;
    terminal.current = false;
    const controller = new AnswerAutosaver({
      paper,
      pending: draft,
      paused: true,
      save: (questionId, selected) =>
        examService.save(paper.attemptId, questionId, selected),
      canSave: () =>
        active &&
        !terminal.current &&
        !fatal.current &&
        !closedRef.current &&
        remainingSeconds(clockRef.current) > 0,
      onChange: (snapshot) => {
        if (active && !terminal.current) {
          if (persistDraft.current)
            setDraftStored(saveAttemptDraft(userId, paper, snapshot));
          setAnswers(snapshot);
        }
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
      clearAttemptDraft(userId, paper.attemptId);
      session.connection?.disconnect();
      setReceipt({ submittedAt: submission?.submittedAt ?? null });
    }
    finishRef.current = finish;
    function handleError(error: unknown) {
      if (!active) return;
      if (hasExamErrorCode(error, 'ATTEMPT_ALREADY_SUBMITTED')) finish();
      else if (
        isExamAuthError(error) ||
        hasExamErrorCode(error, 'FORBIDDEN') ||
        hasExamErrorCode(error, 'RESPONSE_MISMATCH')
      ) {
        fatal.current = true;
        controller.pause();
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
      } else if (remainingSeconds(incoming) > 0) {
        closedRef.current = false;
        setClosed(false);
      }
    }
    function connect() {
      if (!active || terminal.current) return;
      session.connection?.disconnect();
      setConnectionError(null);
      setConnected(false);
      connectedRef.current = false;
      controller.pause();
      session.connection = examService.watch(paper, {
        onRecovered(state) {
          if (!active || terminal.current) return;
          if (
            state.attemptId !== paper.attemptId ||
            state.examId !== paper.examId
          )
            throw new ExamError('RESPONSE_MISMATCH');
          controller.resume(state.answers);
        },
        onClock: syncClock,
        onSubmitted: finish,
        onConnection(value) {
          if (active) {
            const ready = value;
            if (ready) setBrowserOnline(true);
            connectedRef.current = ready;
            setConnected(ready);
            if (!ready) controller.pause();
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
    function offline() {
      setBrowserOnline(false);
      connectedRef.current = false;
      setConnected(false);
      controller.pause();
      connect();
    }
    function online() {
      setBrowserOnline(true);
      connect();
    }
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    connect();
    return () => {
      active = false;
      session.active = false;
      controller.dispose();
      session.connection?.disconnect();
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
      if (runtime.current === session) runtime.current = null;
    };
  }, [paper, userId, draft]);

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
      !connectedRef.current ||
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
    browserOnline,
    draftStored,
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
    retrySaving() {
      if (!connectedRef.current) runtime.current?.reconnect();
      else runtime.current?.controller.retryFailed();
    },
    discardPending() {
      persistDraft.current = false;
      clearAttemptDraft(userId, paper.attemptId);
      runtime.current?.controller.dispose();
    },
    report(type: ProctorEvent, clientAt: string): Promise<void> {
      const session = runtime.current;
      if (
        !session?.active ||
        terminal.current ||
        fatal.current ||
        closedRef.current ||
        !connectedRef.current ||
        remainingSeconds(clockRef.current) === 0
      )
        return Promise.reject(new ExamError('REALTIME_DISCONNECTED'));
      return (
        session.connection?.report(type, clientAt) ??
        Promise.reject(new ExamError('REALTIME_DISCONNECTED'))
      );
    },
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

import type { AttemptPaper, PaperQuestion, SavedAnswer } from './exam-model.ts';
import { sameSelection, validSelection } from './exam-model.ts';
import { ExamError } from './exam-errors.ts';

export type SaveStatus = 'saved' | 'saving' | 'error' | 'queued';
export interface AnswerSnapshot {
  answers: Record<string, string[]>;
  statuses: Record<string, SaveStatus>;
  pendingCount: number;
  failedCount: number;
  queuedCount: number;
}
interface Lane {
  question: PaperQuestion;
  selected: string[];
  confirmed: string[];
  inFlight: Promise<void> | null;
  error: unknown;
  uncertain: boolean;
}
interface AutosaverOptions {
  paper: AttemptPaper;
  save(questionId: string, selected: string[]): Promise<SavedAnswer>;
  canSave(): boolean;
  onChange(snapshot: AnswerSnapshot): void;
  onError(error: unknown): void;
  paused?: boolean;
  pending?: Record<string, string[]>;
}

// One request at a time per question. While it is pending, retain only the
// newest choice, then save that choice after the older request has settled.
export class AnswerAutosaver {
  private lanes = new Map<string, Lane>();
  private disposed = false;
  private paused: boolean;
  constructor(private options: AutosaverOptions) {
    this.paused = options.paused ?? false;
    for (const question of options.paper.questions) {
      const selected =
        options.paper.answers.find(
          (answer) => answer.questionId === question.questionId,
        )?.selectedOptionIds ?? [];
      const pending = options.pending?.[question.questionId];
      this.lanes.set(question.questionId, {
        question,
        selected:
          pending && validSelection(question, pending)
            ? [...pending]
            : [...selected],
        confirmed: [...selected],
        inFlight: null,
        error: null,
        uncertain: !!pending,
      });
    }
  }
  snapshot(): AnswerSnapshot {
    const answers: Record<string, string[]> = {};
    const statuses: Record<string, SaveStatus> = {};
    let pendingCount = 0;
    let failedCount = 0;
    let queuedCount = 0;
    for (const [id, lane] of this.lanes) {
      answers[id] = [...lane.selected];
      const dirty =
        !!lane.inFlight ||
        lane.uncertain ||
        !sameSelection(lane.selected, lane.confirmed);
      statuses[id] = dirty
        ? this.paused
          ? 'queued'
          : lane.error
            ? 'error'
            : 'saving'
        : 'saved';
      if (statuses[id] === 'saving' || statuses[id] === 'queued')
        pendingCount += 1;
      if (statuses[id] === 'queued') queuedCount += 1;
      if (statuses[id] === 'error') failedCount += 1;
    }
    return { answers, statuses, pendingCount, failedCount, queuedCount };
  }
  private notify() {
    if (!this.disposed) this.options.onChange(this.snapshot());
  }
  choose(questionId: string, selected: string[]) {
    const lane = this.lanes.get(questionId);
    if (
      this.disposed ||
      !lane ||
      !this.options.canSave() ||
      !validSelection(lane.question, selected)
    )
      return;
    lane.selected = [...selected];
    lane.error = null;
    this.pump(lane);
    this.notify();
  }
  private pump(lane: Lane) {
    if (
      this.disposed ||
      this.paused ||
      lane.inFlight ||
      lane.error ||
      (!lane.uncertain && sameSelection(lane.selected, lane.confirmed))
    )
      return;
    if (!this.options.canSave()) {
      lane.error = new ExamError('EXAM_ENDED');
      this.notify();
      this.options.onError(lane.error);
      return;
    }
    const sent = [...lane.selected];
    // Defer execution by one microtask so the lane is registered even when
    // a service throws synchronously or a mock resolves immediately.
    lane.inFlight = Promise.resolve()
      .then(() => this.options.save(lane.question.questionId, sent))
      .then((answer) => {
        if (
          answer.questionId !== lane.question.questionId ||
          !sameSelection(answer.selectedOptionIds, sent)
        )
          throw new ExamError('RESPONSE_MISMATCH');
        lane.confirmed = [...sent];
        lane.error = null;
        lane.uncertain = false;
      })
      .catch((error: unknown) => {
        lane.error = error;
        lane.uncertain = true;
        if (!this.disposed) this.options.onError(error);
      })
      .finally(() => {
        lane.inFlight = null;
        if (this.disposed) return;
        this.pump(lane);
        this.notify();
      });
  }
  retryFailed() {
    if (this.disposed) return;
    for (const lane of this.lanes.values()) {
      lane.error = null;
      this.pump(lane);
    }
    this.notify();
  }
  pause() {
    this.paused = true;
    this.notify();
  }
  resume(answers: { questionId: string; optionIds: string[] }[]) {
    if (this.disposed) return;
    for (const answer of answers) {
      const lane = this.lanes.get(answer.questionId);
      if (!lane || !validSelection(lane.question, answer.optionIds))
        throw new ExamError('RESPONSE_MISMATCH');
    }
    const server = new Map(
      answers.map((answer) => [answer.questionId, answer.optionIds]),
    );
    for (const [id, lane] of this.lanes) {
      if (lane.inFlight) continue;
      const dirty =
        lane.uncertain ||
        !!lane.error ||
        !sameSelection(lane.selected, lane.confirmed);
      lane.confirmed = [...(server.get(id) ?? [])];
      if (!dirty) lane.selected = [...lane.confirmed];
      lane.error = null;
    }
    this.paused = false;
    for (const lane of this.lanes.values()) this.pump(lane);
    this.notify();
  }
  async flush(): Promise<boolean> {
    if (this.paused) return false;
    while (!this.disposed) {
      const work = [...this.lanes.values()].flatMap((lane) =>
        lane.inFlight ? [lane.inFlight] : [],
      );
      if (!work.length) {
        const snapshot = this.snapshot();
        return snapshot.failedCount === 0 && snapshot.pendingCount === 0;
      }
      await Promise.all(work);
    }
    return false;
  }
  dispose() {
    this.disposed = true;
  }
}

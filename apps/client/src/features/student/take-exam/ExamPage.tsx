import { useEffect, useRef, useState } from 'react';
import {
  Link,
  useBlocker,
  useOutletContext,
  useParams,
} from 'react-router-dom';
import {
  Check,
  CircleCheck,
  Clock3,
  CloudCheck,
  Flag,
  LoaderCircle,
  RefreshCw,
  Send,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/useAuth';
import { examService, isExamMock } from './exam-service';
import { getExamErrorMessage, isExamAuthError } from './exam-errors';
import { formatRemaining, type LoadedAttempt } from './exam-model';
import { readExamUI, saveExamUI } from './exam-storage';
import { useCountdown, useExamSession, type Receipt } from './useExamSession';
import { QuestionCard } from './QuestionCard';
import { SubmitExamDialog } from './SubmitExamDialog';
import { UnsavedAnswersDialog } from './UnsavedAnswersDialog';
import type { StudentOutletContext } from '@/components/layout/student-outlet';

export default function ExamPage() {
  const { examId = '' } = useParams<{ examId: string }>();
  const { user, retrySession } = useAuth();
  const [loaded, setLoaded] = useState<LoadedAttempt | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoaded(null);
    setError(null);
    examService
      .start(user!.id, examId)
      .then((result) => {
        if (active) setLoaded(result);
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      });
    return () => {
      active = false;
    };
  }, [user, examId, attempt]);

  if (error !== null)
    return (
      <Card className="mx-auto my-10 max-w-lg gap-5 border p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Chưa thể mở bài thi</h1>
        <p role="alert" className="text-base leading-7 text-muted-foreground">
          {getExamErrorMessage(error)}
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Button
            onClick={
              isExamAuthError(error)
                ? retrySession
                : () => setAttempt((value) => value + 1)
            }
          >
            {isExamAuthError(error) ? 'Đăng nhập lại' : 'Thử lại'}
          </Button>
          <Link
            to="/join"
            className="rounded text-sm text-primary underline underline-offset-4"
          >
            Về trang nhập mã
          </Link>
        </div>
      </Card>
    );
  if (!loaded)
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-3 py-24 text-muted-foreground"
      >
        <LoaderCircle
          className="size-5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Đang tải bài thi...
      </div>
    );
  return (
    <ExamWorkspace
      key={loaded.paper.attemptId}
      loaded={loaded}
      userId={user!.id}
    />
  );
}

function ExamWorkspace({
  loaded,
  userId,
}: {
  loaded: LoadedAttempt;
  userId: string;
}) {
  const { paper } = loaded;
  const session = useExamSession(loaded);
  const { retrySession } = useAuth();
  const remaining = useCountdown(session.clock);
  const [ui, setUI] = useState(() => readExamUI(userId, paper));
  const [confirming, setConfirming] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const currentIndex = Math.max(
    0,
    paper.questions.findIndex(
      (question) => question.questionId === ui.currentQuestionId,
    ),
  );
  const question = paper.questions[currentIndex]!;
  const selected = session.answers[question.questionId] ?? [];
  const flagged = ui.flaggedQuestionIds.includes(question.questionId);
  const answered = paper.questions.filter(
    (question) => session.answers[question.questionId]?.length,
  ).length;
  const expired = remaining === 0 || session.closed;
  const disabled = expired || session.fatalError !== null || session.submitting;
  const { beforeLogout } = useOutletContext<StudentOutletContext>();
  const { retrySaving, flush } = session;
  const dirty = session.pendingCount > 0 || session.failedCount > 0;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !session.receipt &&
      (dirty || session.submitting) &&
      currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (
      blocker.state === 'blocked' &&
      (!dirty || session.receipt) &&
      !session.submitting
    )
      blocker.proceed();
  }, [blocker, dirty, session.receipt, session.submitting]);
  useEffect(() => {
    const guard = async () => {
      retrySaving();
      return flush();
    };
    beforeLogout.current = guard;
    return () => {
      if (beforeLogout.current === guard) beforeLogout.current = null;
    };
  }, [beforeLogout, retrySaving, flush]);

  useEffect(() => {
    saveExamUI(
      userId,
      paper.attemptId,
      ui.currentQuestionId,
      ui.flaggedQuestionIds,
    );
  }, [userId, paper.attemptId, ui]);
  function goTo(index: number) {
    const next = paper.questions[index];
    if (!next) return;
    setUI((current) => ({ ...current, currentQuestionId: next.questionId }));
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start' });
  }

  if (session.receipt) return <SubmissionReceipt receipt={session.receipt} />;

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-8">
      <header className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-4 border-b bg-background/95 px-1 py-4 backdrop-blur-sm">
        <div>
          <p className="mb-1 hidden text-sm font-medium text-primary sm:block">
            KHÔNG GIAN LÀM BÀI
          </p>
          <h1 className="text-xl font-semibold tracking-tight sm:text-3xl">
            Bài thi của bạn
          </h1>
        </div>
        <div
          className={`flex items-center gap-3 rounded-xl px-3 py-3 sm:px-5 ${remaining <= 60 || expired ? 'bg-destructive/10 text-destructive' : 'bg-brand-panel text-white'}`}
        >
          <Clock3 className="size-5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm opacity-80">
              <span className="sm:hidden">Còn lại</span>
              <span className="hidden sm:inline">Thời gian còn lại</span>
            </p>
            <p
              role="timer"
              aria-label="Thời gian còn lại"
              className="font-mono text-2xl font-semibold tabular-nums"
              data-testid="exam-timer"
            >
              {formatRemaining(expired ? 0 : remaining)}
            </p>
          </div>
        </div>
      </header>
      {isExamMock && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          Bài thi mô phỏng · Đáp án và thời gian được lưu riêng trên trình duyệt
          để thử giao diện.
        </p>
      )}
      {expired && (
        <div
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 leading-7 text-amber-900"
        >
          Đã hết thời gian làm bài. Các lựa chọn đã được khóa; đang chờ máy chủ
          xác nhận trạng thái bài làm.
        </div>
      )}
      {!expired && remaining <= 300 && (
        <p role="status" className="text-sm font-medium text-warning">
          Còn dưới 5 phút. Bạn hãy kiểm tra các câu chưa trả lời.
        </p>
      )}
      {session.fatalError !== null && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm leading-6 text-destructive"
        >
          {getExamErrorMessage(session.fatalError)}
          {isExamAuthError(session.fatalError) && (
            <Button className="ml-3" variant="outline" onClick={retrySession}>
              Đăng nhập lại
            </Button>
          )}
        </div>
      )}

      <section
        aria-label="Tiến độ bài làm"
        className="rounded-xl border bg-card px-5 py-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p>
            Đã trả lời{' '}
            <strong className="font-semibold">
              {answered} / {paper.questions.length}
            </strong>{' '}
            câu
          </p>
          <p
            className={`flex items-center gap-2 ${session.failedCount ? 'text-destructive' : 'text-muted-foreground'}`}
            aria-live="polite"
            data-testid="save-status"
          >
            {session.pendingCount ? (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <CloudCheck className="size-4" aria-hidden="true" />
            )}
            {session.failedCount
              ? `${session.failedCount} câu chưa lưu thành công`
              : session.pendingCount
                ? `Đang lưu ${session.pendingCount} câu...`
                : 'Mọi thay đổi đã được lưu'}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Số câu đã trả lời"
          aria-valuemin={0}
          aria-valuemax={paper.questions.length}
          aria-valuenow={answered}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-primary transition-[width] motion-reduce:transition-none"
            style={{ width: `${(answered / paper.questions.length) * 100}%` }}
          />
        </div>
        {session.failedCount > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-destructive">
            <span>Các câu chưa lưu vẫn được giữ trên trang này.</span>
            <Button
              variant="link"
              onClick={session.retrySaving}
              disabled={disabled}
            >
              Thử lưu lại
            </Button>
          </div>
        )}
      </section>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <QuestionCard
          ref={heading}
          question={question}
          index={currentIndex}
          total={paper.questions.length}
          selected={selected}
          flagged={flagged}
          disabled={disabled}
          saveStatus={session.statuses[question.questionId] ?? 'saved'}
          onChoose={(value) => session.choose(question.questionId, value)}
          onFlag={() =>
            setUI((current) => ({
              ...current,
              flaggedQuestionIds: flagged
                ? current.flaggedQuestionIds.filter(
                    (id) => id !== question.questionId,
                  )
                : [...current.flaggedQuestionIds, question.questionId],
            }))
          }
          onPrevious={() => goTo(currentIndex - 1)}
          onNext={() => goTo(currentIndex + 1)}
        />

        <aside className="space-y-4 lg:sticky lg:top-36">
          <Card className="gap-5 border p-5">
            <h2 className="text-lg font-semibold">Danh sách câu hỏi</h2>
            <nav
              aria-label="Điều hướng câu hỏi"
              className="grid max-h-72 grid-cols-5 gap-2 overflow-y-auto p-1 sm:grid-cols-8 lg:grid-cols-5"
            >
              {paper.questions.map((item, index) => {
                const hasAnswer = !!session.answers[item.questionId]?.length;
                const hasFlag = ui.flaggedQuestionIds.includes(item.questionId);
                return (
                  <button
                    key={item.questionId}
                    type="button"
                    aria-label={`Câu ${index + 1}, ${hasAnswer ? 'đã trả lời' : 'chưa trả lời'}${hasFlag ? ', đã đánh dấu' : ''}`}
                    aria-current={index === currentIndex ? 'step' : undefined}
                    onClick={() => goTo(index)}
                    className={`relative flex h-11 min-w-0 items-center justify-center rounded-lg border text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${hasAnswer ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:bg-muted'} ${index === currentIndex ? 'ring-2 ring-ring ring-offset-2 ring-offset-card' : ''}`}
                  >
                    {index + 1}
                    {hasFlag && (
                      <Flag
                        className={`absolute right-0.5 top-0.5 size-3 fill-current ${hasAnswer ? 'text-yellow-200' : 'text-warning'}`}
                        aria-hidden="true"
                      />
                    )}
                  </button>
                );
              })}
            </nav>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Check className="size-4 text-primary" aria-hidden="true" />
                Đã trả lời
              </span>
              <span className="flex items-center gap-1.5">
                <Flag className="size-4 text-warning" aria-hidden="true" />
                Đánh dấu
              </span>
            </div>
            <div className="border-t pt-4">
              <p className="mb-4 text-sm leading-6 text-muted-foreground">
                Còn {paper.questions.length - answered} câu chưa trả lời. Bạn có
                thể quay lại các câu đã đánh dấu trước khi nộp.
              </p>
              <Button
                className="w-full"
                onClick={() => setConfirming(true)}
                disabled={disabled}
              >
                <Send aria-hidden="true" />
                Nộp bài
              </Button>
            </div>
          </Card>
          <div className="rounded-xl border bg-card p-4 text-sm leading-6 text-muted-foreground">
            <p
              className={`flex items-center gap-2 font-medium ${session.connected ? 'text-success' : 'text-warning'}`}
            >
              <Wifi className="size-4" aria-hidden="true" />
              {session.connected
                ? 'Đang đồng bộ thời gian'
                : 'Chưa kết nối đồng bộ thời gian'}
            </p>
            <p className="mt-2">
              Đáp án được tự động lưu sau mỗi lựa chọn. Đánh dấu câu chỉ giúp
              bạn xem lại.
            </p>
            {!session.connected && (
              <>
                <p className="mt-2">
                  {session.connectionError !== null
                    ? getExamErrorMessage(session.connectionError)
                    : 'Đồng hồ tiếp tục tính từ lần đồng bộ gần nhất.'}
                </p>
                <Button
                  variant="link"
                  onClick={session.reconnect}
                  disabled={session.fatalError !== null}
                >
                  <RefreshCw aria-hidden="true" />
                  Đồng bộ lại
                </Button>
              </>
            )}
          </div>
        </aside>
      </div>
      {confirming && (
        <SubmitExamDialog
          answered={answered}
          total={paper.questions.length}
          flagged={ui.flaggedQuestionIds.length}
          failed={session.failedCount}
          submitting={session.submitting}
          disabled={expired || session.fatalError !== null}
          error={session.submitError}
          onClose={() => setConfirming(false)}
          onConfirm={() => {
            void session.submit();
          }}
          onRetry={session.retrySaving}
        />
      )}
      {blocker.state === 'blocked' && (
        <UnsavedAnswersDialog
          failed={session.failedCount > 0}
          submitting={session.submitting}
          onStay={() => blocker.reset()}
          onRetry={session.retrySaving}
          onLeave={() => blocker.proceed()}
        />
      )}
    </div>
  );
}

function SubmissionReceipt({ receipt }: { receipt: Receipt }) {
  return (
    <Card className="mx-auto my-8 max-w-lg items-center gap-5 border p-6 text-center sm:my-14 sm:p-10">
      <span className="flex size-16 items-center justify-center rounded-full bg-success/10 text-success">
        <CircleCheck className="size-8" aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-semibold">Đã nộp bài</h1>
      <p className="text-base leading-7 text-muted-foreground">
        Máy chủ đã xác nhận bài làm của bạn được nộp. Bạn có thể rời trang này.
      </p>
      {receipt.submittedAt && (
        <p className="text-sm text-muted-foreground">
          Thời điểm nộp: {new Date(receipt.submittedAt).toLocaleString('vi-VN')}
        </p>
      )}
      <Link
        to="/join"
        className="rounded-lg bg-primary px-5 py-3 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Về trang nhập mã
      </Link>
    </Card>
  );
}

import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { z, ZodError } from 'zod';
import {
  Award,
  CircleCheck,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/useAuth';
import { examService, isExamMock } from '../take-exam/exam-service';
import {
  readAttemptReference,
  saveAttemptReference,
} from '../take-exam/exam-storage';
import {
  ExamError,
  getExamErrorMessage,
  hasExamErrorCode,
  isExamAuthError,
} from '../take-exam/exam-errors';
import { formatRemaining } from '../take-exam/exam-model';
import type { AttemptResult } from './result-model';
import { ResultQuestionCard } from './ResultQuestionCard';
import { clearAttemptDraft } from '../take-exam/attempt-draft';

const statusLabels = {
  SUBMITTED: 'Nộp bài thủ công',
  AUTO_SUBMITTED: 'Máy chủ tự chốt bài',
  FORCE_SUBMITTED: 'Giáo viên chốt bài',
};

export default function ResultsPage() {
  const { examId = '' } = useParams<{ examId: string }>();
  const [search] = useSearchParams();
  const { user, retrySession } = useAuth();
  const attemptId =
    search.get('attemptId') ?? readAttemptReference(user!.id, examId);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setResult(null);
    setError(null);
    const id = z.string().uuid().safeParse(attemptId);
    if (!id.success || !z.string().uuid().safeParse(examId).success) {
      setLoading(false);
      setError(new ExamError('RESULT_REFERENCE_MISSING'));
      return;
    }
    examService
      .result(user!.id, examId, id.data)
      .then((data) => {
        if (active) {
          saveAttemptReference(user!.id, examId, data.attemptId);
          clearAttemptDraft(user!.id, data.attemptId);
          setResult(data);
        }
      })
      .catch((caught: unknown) => {
        if (active) setError(caught);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, examId, attemptId, attempt]);

  if (loading)
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-3 py-24 text-muted-foreground"
      >
        <LoaderCircle
          className="size-5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        Đang tải kết quả...
      </div>
    );
  if (error !== null || !result)
    return (
      <Card className="mx-auto my-10 max-w-lg gap-5 border p-6 sm:p-8">
        <h1 className="text-2xl font-semibold">Chưa thể mở kết quả</h1>
        <p role="alert" className="text-base leading-7 text-muted-foreground">
          {error instanceof ZodError
            ? 'Dữ liệu kết quả chưa hợp lệ. Bạn hãy thử lại hoặc báo giáo viên.'
            : getExamErrorMessage(error)}
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
            to={
              hasExamErrorCode(error, 'ATTEMPT_NOT_SUBMITTED')
                ? `/exam/${examId}/take`
                : '/join'
            }
            className="rounded text-sm text-primary underline underline-offset-4"
          >
            {hasExamErrorCode(error, 'ATTEMPT_NOT_SUBMITTED')
              ? 'Tiếp tục làm bài'
              : 'Về trang nhập mã'}
          </Link>
        </div>
      </Card>
    );

  const duration = Math.max(
    0,
    Math.floor(
      (Date.parse(result.submittedAt) - Date.parse(result.startedAt)) / 1000,
    ),
  );
  const fullCredit = result.questions?.filter(
    (question) => question.earnedPoints === question.points,
  ).length;
  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2 sm:py-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-success">
            <CircleCheck className="size-4" aria-hidden="true" />
            Đã nộp bài
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Kết quả bài thi
          </h1>
          <p className="mt-3 break-words text-lg leading-7 text-muted-foreground">
            {result.examTitle}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setAttempt((value) => value + 1)}
        >
          <RefreshCw aria-hidden="true" />
          Tải lại kết quả
        </Button>
      </header>
      {isExamMock && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
          Kết quả mô phỏng của bài thi mẫu, dùng để thử giao diện.
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-[1.05fr_1fr]">
        <section
          aria-labelledby="score-title"
          className="rounded-2xl bg-brand-panel p-6 text-white sm:p-8"
        >
          <div className="flex items-center gap-3">
            <Award className="size-6 text-blue-200" aria-hidden="true" />
            <h2 id="score-title" className="font-medium text-blue-100">
              Điểm của bạn
            </h2>
          </div>
          <p
            className="mt-6 break-words text-5xl font-semibold tracking-tight"
            data-testid="result-score"
          >
            {result.score.toLocaleString('vi-VN')}
            <span className="ml-2 text-xl font-normal text-blue-100/80">
              / {result.maxScore.toLocaleString('vi-VN')}
            </span>
          </p>
          <p className="mt-5 text-sm leading-6 text-blue-100/80">
            Điểm được máy chủ xác nhận cho bài làm này.
          </p>
        </section>
        <Card className="gap-5 border p-6 sm:p-8">
          <h2 className="text-lg font-semibold">Thông tin bài làm</h2>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="flex items-center gap-2 text-muted-foreground">
                <Clock3 className="size-4" aria-hidden="true" />
                Thời gian làm bài
              </dt>
              <dd className="mt-1 text-lg font-medium tabular-nums">
                {formatRemaining(duration)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Hình thức nộp</dt>
              <dd className="mt-1 text-base font-medium">
                {statusLabels[result.status]}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Thời điểm nộp</dt>
              <dd className="mt-1 text-base">
                {new Date(result.submittedAt).toLocaleString('vi-VN')}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
      {result.questions === null ? (
        <section
          className="flex gap-4 rounded-xl border bg-card p-5 sm:p-6"
          aria-labelledby="locked-title"
        >
          <LockKeyhole
            className="mt-1 size-6 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div>
            <h2 id="locked-title" className="text-lg font-semibold">
              Chi tiết đáp án chưa được công bố
            </h2>
            <p className="mt-2 leading-7 text-muted-foreground">
              Bạn đã có thể xem điểm. Đáp án đúng và lời giải sẽ được mở sau khi
              kỳ thi kết thúc; hãy tải lại kết quả để kiểm tra.
            </p>
          </div>
        </section>
      ) : (
        <section aria-labelledby="review-title" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="review-title" className="text-xl font-semibold">
              Xem lại từng câu
            </h2>
            <p className="text-sm text-muted-foreground">
              {fullCredit} / {result.questions.length} câu đạt đủ điểm
            </p>
          </div>
          {result.questions.map((question, index) => (
            <ResultQuestionCard
              key={question.questionId}
              question={question}
              index={index}
            />
          ))}
        </section>
      )}
      <Link
        to="/join"
        className="inline-flex rounded-lg border bg-card px-5 py-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Về trang nhập mã
      </Link>
    </div>
  );
}

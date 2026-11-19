import {
  Link,
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  Check,
  CircleCheck,
  Clock3,
  DoorOpen,
  FileQuestion,
  Hourglass,
  LoaderCircle,
  RefreshCw,
  UserRound,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/features/auth/useAuth';
import { getRoomErrorMessage, isRoomAuthError } from '../room/room-errors';
import { forgetRoom } from '../room/room-storage';
import { roomCodeSchema } from '../room/room-model';
import { useWaitingRoom } from './useWaitingRoom';

export default function WaitingRoomPage() {
  const { examId = '' } = useParams<{ examId: string }>();
  const { user, retrySession } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const navigationState: unknown = location.state;
  const candidate =
    navigationState &&
    typeof navigationState === 'object' &&
    'roomCode' in navigationState
      ? roomCodeSchema.safeParse(navigationState.roomCode)
      : null;
  const navigationCode = candidate?.success ? candidate.data : undefined;
  const { loading, exam, clock, room, connection, error, retry } =
    useWaitingRoom(user!.id, examId, navigationCode);
  const connected = connection === 'connected';
  const ended = clock?.status === 'ENDED';

  function leave() {
    forgetRoom(user!.id);
    navigate('/join', { replace: true });
  }

  if (loading)
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-3 py-24 text-muted-foreground"
      >
        <LoaderCircle
          className="size-5 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />{' '}
        Đang tải phòng thi...
      </div>
    );
  // Only a fresh realtime snapshot/event may start navigation. Cached values
  // and the browser clock never start an exam or create an attempt.
  if (connected && clock?.status === 'RUNNING')
    return <Navigate to={`/exam/${examId}/take`} replace />;

  if (!exam)
    return (
      <Card className="mx-auto my-10 max-w-lg gap-5 border p-6 sm:p-8">
        <DoorOpen className="size-9 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-semibold">Chưa thể mở phòng chờ</h1>
        <p role="alert" className="text-base leading-7 text-muted-foreground">
          {getRoomErrorMessage(error)}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={isRoomAuthError(error) ? retrySession : retry}>
            {isRoomAuthError(error) ? 'Đăng nhập lại' : 'Thử lại'}
          </Button>
          <Button variant="outline" onClick={leave}>
            Nhập lại mã phòng
          </Button>
        </div>
      </Card>
    );

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-2 sm:py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium text-primary">
          <DoorOpen className="size-4" aria-hidden="true" /> Phòng chờ
        </p>
        <Button variant="outline" onClick={leave}>
          Rời phòng
        </Button>
      </div>
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0">
          <h1 className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">
            {exam.title}
          </h1>
          <p className="mt-2 leading-7 text-muted-foreground">
            Kiểm tra thông tin kỳ thi và giữ trang này mở để nhận thông báo bắt
            đầu.
          </p>
        </div>
        <div className="shrink-0 rounded-xl border bg-card px-5 py-3">
          <p className="text-sm text-muted-foreground">Mã phòng</p>
          <p className="mt-1 font-mono text-xl font-semibold tracking-[0.18em]">
            {exam.roomCode}
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <section
            aria-labelledby="waiting-status"
            className={`rounded-2xl border p-6 sm:p-8 ${ended ? 'bg-muted' : 'border-primary/15 bg-secondary/50'}`}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-card text-primary shadow-sm">
                {ended ? (
                  <CircleCheck className="size-6" aria-hidden="true" />
                ) : connected ? (
                  <Hourglass className="size-6" aria-hidden="true" />
                ) : (
                  <WifiOff className="size-6" aria-hidden="true" />
                )}
              </span>
              <div aria-live="polite" className="min-w-0 flex-1">
                <h2 id="waiting-status" className="text-xl font-semibold">
                  {ended
                    ? 'Kỳ thi đã kết thúc'
                    : connected
                      ? 'Đã vào phòng, chờ giáo viên bắt đầu'
                      : connection === 'failed'
                        ? 'Chưa thể kết nối phòng thi'
                        : connection === 'reconnecting'
                          ? 'Đang kết nối lại phòng thi...'
                          : 'Đang kết nối phòng thi...'}
                </h2>
                <p className="mt-2 leading-7 text-muted-foreground">
                  {ended
                    ? 'Phòng thi đã đóng. Bạn có thể rời phòng hoặc liên hệ giáo viên.'
                    : connected
                      ? 'Khi giáo viên bắt đầu, hệ thống sẽ tự chuyển bạn đến trang làm bài.'
                      : 'Trạng thái kỳ thi sẽ được cập nhật sau khi kết nối với máy chủ được khôi phục.'}
                </p>
              </div>
            </div>
            {error !== null && (
              <p
                role="alert"
                className="mt-4 rounded-lg border border-destructive/20 bg-card p-3 text-sm leading-6 text-destructive"
              >
                {getRoomErrorMessage(error)}
              </p>
            )}
            {!connected && (
              <Button
                className="mt-5"
                variant="outline"
                onClick={isRoomAuthError(error) ? retrySession : retry}
              >
                <RefreshCw aria-hidden="true" />
                {isRoomAuthError(error) ? 'Đăng nhập lại' : 'Thử kết nối lại'}
              </Button>
            )}
          </section>

          <Card className="gap-5 border p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Thông tin bài thi</h2>
            <dl className="grid gap-5 sm:grid-cols-3">
              <div>
                <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock3 className="size-4" aria-hidden="true" /> Thời gian làm
                  bài
                </dt>
                <dd className="mt-2 text-xl font-semibold">
                  {Number((exam.durationSec / 60).toFixed(1)).toLocaleString(
                    'vi-VN',
                  )}{' '}
                  phút
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                  <FileQuestion className="size-4" aria-hidden="true" /> Số câu
                  hỏi
                </dt>
                <dd className="mt-2 text-xl font-semibold">
                  {exam.questionCount} câu
                </dd>
              </div>
              <div>
                <dt className="flex items-center gap-2 text-sm text-muted-foreground">
                  <RefreshCw className="size-4" aria-hidden="true" /> Lượt đã sử
                  dụng
                </dt>
                <dd className="mt-2 text-xl font-semibold">
                  {exam.attemptsUsed} / {exam.maxAttempts}
                </dd>
              </div>
            </dl>
          </Card>

          <Card className="gap-5 border p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Trong phòng thi</h2>
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="size-4" aria-hidden="true" />
                <span aria-live="polite" data-testid="participant-count">
                  {connected && room
                    ? `${room.participantCount} kết nối`
                    : 'Đang cập nhật số kết nối'}
                </span>
              </p>
            </div>
            <div className="flex min-w-0 items-center gap-3 rounded-xl bg-background p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary">
                <UserRound className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {user!.name}{' '}
                  <span className="text-sm font-normal text-muted-foreground">
                    (Bạn)
                  </span>
                </p>
                <p className="mt-1 break-all text-sm text-muted-foreground">
                  {user!.email}
                </p>
              </div>
              {connected && (
                <Check
                  className="size-5 shrink-0 text-success"
                  aria-label="Đã kết nối"
                />
              )}
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Số kết nối bao gồm cả giáo viên và các thiết bị đang mở phòng thi.
            </p>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="gap-5 border p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Trong lúc chờ</h2>
            <ul className="space-y-4 text-base leading-7 text-muted-foreground">
              {[
                'Đọc kỹ thông tin và thời gian làm bài.',
                'Chuẩn bị thiết bị, nguồn điện và kết nối mạng.',
                'Giữ trang phòng chờ mở và làm theo hướng dẫn của giáo viên.',
              ].map((text) => (
                <li key={text} className="flex gap-2.5">
                  <CircleCheck
                    className="mt-1.5 size-4 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                  <span>{text}</span>
                </li>
              ))}
            </ul>
          </Card>
          <div
            className="rounded-xl border bg-card p-5 text-sm leading-6"
            aria-live="polite"
          >
            <p
              className={`flex items-center gap-2 font-medium ${connected ? 'text-success' : 'text-warning'}`}
            >
              {connected ? (
                <Wifi className="size-4" aria-hidden="true" />
              ) : (
                <WifiOff className="size-4" aria-hidden="true" />
              )}
              {connected ? 'Đã kết nối phòng thi' : 'Chưa có kết nối phòng thi'}
            </p>
            <p className="mt-2 text-muted-foreground">
              Nếu kết nối bị gián đoạn, hệ thống sẽ thử kết nối lại và cập nhật
              trạng thái mới nhất.
            </p>
          </div>
          <p className="text-center text-sm leading-6 text-muted-foreground">
            Vào nhầm phòng?{' '}
            <Link
              to="/join"
              onClick={() => forgetRoom(user!.id)}
              className="rounded text-primary underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            >
              Nhập mã khác
            </Link>
          </p>
        </aside>
      </div>
    </div>
  );
}

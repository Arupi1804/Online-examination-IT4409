import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  DoorOpen,
  KeyRound,
  LoaderCircle,
  MonitorCheck,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FormField } from '@/components/ui/form-field';
import { useAuth } from '@/features/auth/useAuth';
import { getRoomErrorMessage, isRoomAuthError } from './room-errors';
import { roomCodeSchema } from './room-model';
import { isRoomMock, roomService } from './room-service';
import { saveRoom } from './room-storage';

export default function JoinRoomPage() {
  const { user, retrySession } = useAuth();
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);
  const [code, setCode] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || !user) return;
    setError(null);
    const result = roomCodeSchema.safeParse(code);
    if (!result.success) {
      setFieldError(
        code.trim()
          ? result.error.issues[0]!.message
          : 'Bạn hãy nhập mã phòng do giáo viên cung cấp.',
      );
      form.current?.querySelector<HTMLInputElement>('#room-code')?.focus();
      return;
    }
    setFieldError('');
    setCode(result.data);
    submitting.current = true;
    setPending(true);
    try {
      const room = await roomService.lookup(result.data);
      saveRoom(user.id, room);
      navigate(`/exam/${room.examId}/waiting`, {
        state: { roomCode: room.roomCode },
      });
    } catch (caught) {
      setError(caught);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl py-4 sm:py-10">
      <div className="mb-8 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Check className="size-4 text-success" aria-hidden="true" /> Đã đăng
        nhập
        <span className="mx-2 h-px w-8 bg-border" aria-hidden="true" />
        <span className="font-medium text-primary">Vào phòng thi</span>
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:gap-14">
        <section aria-labelledby="join-title">
          <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-secondary text-primary">
            <DoorOpen className="size-7" aria-hidden="true" />
          </span>
          <h1
            id="join-title"
            className="text-3xl font-semibold tracking-tight sm:text-4xl"
          >
            Vào phòng thi
          </h1>
          <p className="mt-3 max-w-md leading-7 text-muted-foreground">
            Nhập mã phòng từ giáo viên để tham gia kỳ thi. Một chút chuẩn bị,
            sẵn sàng làm bài.
          </p>
          <Card className="mt-7 border p-5 shadow-sm sm:p-7">
            <form
              ref={form}
              onSubmit={handleSubmit}
              noValidate
              aria-busy={pending}
              className="space-y-5"
            >
              <FormField
                id="room-code"
                label="Mã phòng thi"
                hint="6 ký tự chữ và số, không phân biệt chữ hoa hay thường."
                placeholder="VD: K7M2QX"
                value={code}
                maxLength={32}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={pending}
                error={fieldError}
                className="h-14 font-mono text-xl tracking-[0.18em] md:text-xl"
                onChange={(event) => {
                  setCode(event.target.value.toUpperCase());
                  setFieldError('');
                  setError(null);
                }}
              />
              {error !== null && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive"
                >
                  {getRoomErrorMessage(error)}
                </div>
              )}
              {isRoomAuthError(error) ? (
                <Button type="button" className="w-full" onClick={retrySession}>
                  Đăng nhập lại
                </Button>
              ) : (
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? (
                    <LoaderCircle
                      className="animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <KeyRound aria-hidden="true" />
                  )}
                  {pending ? 'Đang tìm phòng...' : 'Vào phòng thi'}
                </Button>
              )}
              <p className="text-center text-sm leading-6 text-muted-foreground">
                Chưa có mã phòng? Hãy liên hệ giáo viên của bạn.
              </p>
            </form>
          </Card>
          {isRoomMock && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-800">
              Phòng mô phỏng: <strong className="font-mono">K7M2QX</strong> để
              chờ, <strong className="font-mono">RUN2AB</strong> để thử chuyển
              sang làm bài, <strong className="font-mono">ENDED2</strong> để thử
              phòng đã kết thúc.
            </p>
          )}
        </section>
        <aside
          className="rounded-2xl bg-brand-panel p-6 text-white sm:p-8 lg:mt-10"
          aria-labelledby="prepare-title"
        >
          <p className="text-sm font-medium text-blue-200">TRƯỚC KHI BẮT ĐẦU</p>
          <h2
            id="prepare-title"
            className="mt-3 text-2xl font-semibold tracking-tight"
          >
            Sẵn sàng cho bài thi của bạn
          </h2>
          <ul className="mt-7 space-y-6">
            {[
              {
                icon: KeyRound,
                title: 'Kiểm tra đúng mã phòng',
                text: 'Mỗi kỳ thi có một mã riêng do giáo viên cung cấp.',
              },
              {
                icon: Wifi,
                title: 'Giữ kết nối ổn định',
                text: 'Chọn nơi có mạng tốt và chuẩn bị nguồn điện cho thiết bị.',
              },
              {
                icon: MonitorCheck,
                title: 'Chờ hiệu lệnh bắt đầu',
                text: 'Sau khi vào phòng, bạn sẽ thấy thông tin bài thi và chờ giáo viên.',
              },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <Icon
                  className="mt-1 size-5 shrink-0 text-blue-200"
                  aria-hidden="true"
                />
                <div>
                  <h3 className="font-medium">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-blue-100/80">
                    {text}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

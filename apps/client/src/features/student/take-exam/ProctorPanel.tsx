import { Maximize, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { useProctoring } from './useProctoring';
import type { ProctorEvent } from './exam-model';

const messages: Record<ProctorEvent, string> = {
  TAB_BLUR: 'Bạn vừa chuyển khỏi trang thi.',
  FULLSCREEN_EXIT: 'Bạn vừa thoát toàn màn hình.',
  COPY_PASTE: 'Bạn vừa thực hiện sao chép, cắt hoặc dán trong vùng câu hỏi.',
  DISCONNECT: 'Kết nối với phòng thi vừa bị gián đoạn.',
};

export function ProctorPanel({
  proctor,
  disabled,
}: {
  proctor: ReturnType<typeof useProctoring>;
  disabled: boolean;
}) {
  return (
    <section
      className="space-y-3 rounded-xl border bg-card p-4 text-sm leading-6"
      aria-labelledby="proctor-title"
    >
      <h2 id="proctor-title" className="flex items-center gap-2 font-medium">
        <ShieldCheck className="size-4 text-primary" aria-hidden="true" />
        Trong lúc làm bài
      </h2>
      <p className="text-muted-foreground">
        Giữ trang thi mở và làm theo hướng dẫn của giáo viên. Chuyển khỏi trang
        thi, thoát toàn màn hình, sao chép/cắt/dán trong vùng câu hỏi và gián
        đoạn kết nối sẽ được ghi nhận.
      </p>
      <Button
        className="h-auto min-h-11 w-full whitespace-normal py-2.5"
        variant="outline"
        onClick={() => {
          void proctor.enterFullscreen();
        }}
        disabled={disabled || proctor.fullscreen}
      >
        <Maximize aria-hidden="true" />
        {proctor.fullscreen ? 'Đang toàn màn hình' : 'Vào toàn màn hình'}
      </Button>
      {proctor.fullscreenError && (
        <p role="alert" className="text-warning">
          {proctor.fullscreenError}
        </p>
      )}
      {proctor.observed > 0 && (
        <div
          className="rounded-lg bg-amber-50 p-3 text-amber-900"
          role="status"
        >
          <p>
            {proctor.lastEvent && messages[proctor.lastEvent]} Hãy tiếp tục tập
            trung làm bài.
          </p>
          {proctor.pendingDisconnect && (
            <p className="mt-2">
              Sự kiện mất kết nối đang chờ xác nhận lại bài làm trước khi gửi.
            </p>
          )}
          <p className="mt-2">
            Trong lần mở trang này: {proctor.observed} sự kiện,{' '}
            {proctor.confirmed} đã được máy chủ xác nhận.
          </p>
          {proctor.unconfirmed > 0 && (
            <p className="mt-1">
              Có sự kiện chưa gửi hoặc chưa nhận được xác nhận.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

import { Maximize, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { useProctoring } from './useProctoring';

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
        thi hoặc thoát toàn màn hình sẽ được ghi nhận.
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
            {proctor.lastEvent === 'FULLSCREEN_EXIT'
              ? 'Bạn vừa thoát toàn màn hình.'
              : 'Bạn vừa chuyển khỏi trang thi.'}{' '}
            Hãy tiếp tục tập trung làm bài.
          </p>
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

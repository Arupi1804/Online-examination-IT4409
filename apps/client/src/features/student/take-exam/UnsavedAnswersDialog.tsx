import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';

export function UnsavedAnswersDialog({
  failed,
  submitting,
  onStay,
  onRetry,
  onLeave,
}: {
  failed: boolean;
  submitting: boolean;
  onStay(): void;
  onRetry(): void;
  onLeave(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="unsaved-title"
      onCancel={(event) => {
        event.preventDefault();
        onStay();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border bg-card p-6 text-foreground shadow-xl backdrop:bg-foreground/40"
    >
      <h2 id="unsaved-title" className="text-xl font-semibold">
        {submitting ? 'Đang chờ xác nhận nộp bài' : 'Còn đáp án chưa lưu'}
      </h2>
      <p className="mt-3 text-base leading-7 text-muted-foreground">
        {failed
          ? 'Có đáp án chưa gửi thành công đến máy chủ. Nếu rời trang ngay, bạn có thể mất những thay đổi này.'
          : 'Trang sẽ chuyển sau khi máy chủ xác nhận dữ liệu. Bạn có thể tiếp tục ở lại bài thi.'}
      </p>
      <div className="mt-5 flex flex-wrap gap-3">
        <Button variant="outline" onClick={onStay}>
          Ở lại bài thi
        </Button>
        {failed && <Button onClick={onRetry}>Lưu rồi rời trang</Button>}
        {!submitting && (
          <Button variant="destructive" onClick={onLeave}>
            Rời trang, bỏ thay đổi chưa lưu
          </Button>
        )}
      </div>
    </dialog>
  );
}

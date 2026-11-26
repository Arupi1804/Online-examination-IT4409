import { useLayoutEffect, useRef } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getExamErrorMessage } from './exam-errors';

interface Props {
  answered: number;
  total: number;
  flagged: number;
  failed: number;
  submitting: boolean;
  disabled: boolean;
  error: unknown;
  onClose(): void;
  onConfirm(): void;
  onRetry(): void;
}
export function SubmitExamDialog({
  answered,
  total,
  flagged,
  failed,
  submitting,
  disabled,
  error,
  onClose,
  onConfirm,
  onRetry,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    const trigger = document.activeElement;
    element?.showModal();
    return () => {
      element?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="submit-title"
      aria-describedby="submit-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!submitting) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto overscroll-contain rounded-2xl border bg-card p-6 text-foreground shadow-xl backdrop:bg-foreground/40 sm:p-8"
    >
      <h2 id="submit-title" className="text-2xl font-semibold">
        Nộp bài thi?
      </h2>
      <p
        id="submit-description"
        className="mt-3 text-base leading-7 text-muted-foreground"
      >
        Sau khi máy chủ xác nhận nộp bài, bạn sẽ không thể thay đổi đáp án.
      </p>
      <dl className="mt-5 space-y-3 rounded-xl bg-background p-4 text-base">
        <div className="flex flex-wrap justify-between gap-4">
          <dt>Đã trả lời</dt>
          <dd className="font-semibold">
            {answered} / {total} câu
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-4">
          <dt>Chưa trả lời</dt>
          <dd
            className={
              total > answered ? 'font-semibold text-warning' : 'font-semibold'
            }
          >
            {total - answered} câu
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-4">
          <dt>Đã đánh dấu</dt>
          <dd className="font-semibold">{flagged} câu</dd>
        </div>
      </dl>
      {failed > 0 && (
        <div role="alert" className="mt-4 text-sm leading-6 text-destructive">
          Còn {failed} câu chưa lưu thành công.
          <Button
            variant="link"
            disabled={submitting || disabled}
            onClick={onRetry}
          >
            Thử lưu lại
          </Button>
        </div>
      )}
      {error !== null && (
        <p role="alert" className="mt-4 text-sm leading-6 text-destructive">
          {getExamErrorMessage(error)}
        </p>
      )}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          className="h-auto min-h-11 whitespace-normal py-3"
          disabled={submitting}
          onClick={onClose}
        >
          Tiếp tục làm bài
        </Button>
        <Button
          className="h-auto min-h-11 whitespace-normal py-3"
          disabled={submitting || disabled || failed > 0}
          onClick={onConfirm}
        >
          {submitting && (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {submitting ? 'Đang nộp bài...' : 'Xác nhận nộp bài'}
        </Button>
      </div>
    </dialog>
  );
}

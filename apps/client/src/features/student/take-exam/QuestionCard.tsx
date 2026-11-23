import { forwardRef } from 'react';
import { Flag, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { PaperQuestion } from './exam-model';
import type { SaveStatus } from './answer-autosaver';

interface Props {
  question: PaperQuestion;
  index: number;
  total: number;
  selected: string[];
  flagged: boolean;
  disabled: boolean;
  saveStatus: SaveStatus;
  onChoose(selected: string[]): void;
  onFlag(): void;
  onPrevious(): void;
  onNext(): void;
}
const typeLabels = {
  SINGLE: 'Một lựa chọn',
  MULTIPLE: 'Nhiều lựa chọn',
  TRUE_FALSE: 'Đúng / Sai',
};

export const QuestionCard = forwardRef<HTMLHeadingElement, Props>(
  function QuestionCard(
    {
      question,
      index,
      total,
      selected,
      flagged,
      disabled,
      saveStatus,
      onChoose,
      onFlag,
      onPrevious,
      onNext,
    },
    ref,
  ) {
    return (
      <Card className="min-w-0 gap-6 border p-5 sm:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-md bg-secondary px-2.5 py-1 font-medium text-primary">
              {typeLabels[question.type]}
            </span>
            <span className="text-muted-foreground">
              {question.points.toLocaleString('vi-VN')} điểm
            </span>
          </div>
          <Button
            variant={flagged ? 'secondary' : 'outline'}
            className="h-auto min-h-11 max-w-full whitespace-normal py-2.5"
            onClick={onFlag}
            aria-pressed={flagged}
            disabled={disabled}
          >
            <Flag
              className={flagged ? 'fill-current' : ''}
              aria-hidden="true"
            />
            {flagged ? 'Đã đánh dấu' : 'Đánh dấu câu'}
          </Button>
        </div>
        <div>
          <h2
            ref={ref}
            tabIndex={-1}
            className="scroll-mt-40 rounded text-xl font-semibold outline-none"
          >
            Câu {index + 1}{' '}
            <span className="font-normal text-muted-foreground">/ {total}</span>
          </h2>
          <p className="mt-4 whitespace-pre-wrap break-words text-lg leading-8">
            {question.content}
          </p>
          <p className="mt-3 text-sm text-muted-foreground">
            {question.type === 'MULTIPLE'
              ? 'Có thể chọn nhiều đáp án.'
              : 'Chọn một đáp án.'}
          </p>
        </div>
        <fieldset disabled={disabled} className="min-w-0 space-y-3">
          <legend className="sr-only">Chọn đáp án cho câu {index + 1}</legend>
          {question.options.map((option, optionIndex) => {
            const checked = selected.includes(option.id);
            return (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors focus-within:ring-2 focus-within:ring-ring/40 ${checked ? 'border-primary bg-secondary/60' : 'border-border bg-card hover:bg-background'} ${disabled ? 'cursor-default opacity-70' : ''}`}
              >
                <input
                  className="mt-1.5 size-4 shrink-0 accent-primary"
                  type={question.type === 'MULTIPLE' ? 'checkbox' : 'radio'}
                  name={question.questionId}
                  value={option.id}
                  checked={checked}
                  onChange={() =>
                    onChoose(
                      question.type === 'MULTIPLE'
                        ? checked
                          ? selected.filter((id) => id !== option.id)
                          : [...selected, option.id]
                        : [option.id],
                    )
                  }
                />
                <span
                  className="mt-0.5 text-sm font-semibold text-muted-foreground"
                  aria-hidden="true"
                >
                  {String.fromCharCode(65 + optionIndex)}.
                </span>
                <span className="min-w-0 whitespace-pre-wrap break-words text-base leading-7">
                  {option.content}
                </span>
              </label>
            );
          })}
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <Button
            variant="ghost"
            className="h-auto min-h-11 max-w-full whitespace-normal py-2.5"
            disabled={disabled || !selected.length}
            onClick={() => onChoose([])}
          >
            Bỏ chọn đáp án
          </Button>
          <p
            className={`flex items-center gap-2 text-sm ${saveStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
            aria-live="polite"
          >
            {saveStatus === 'saving' && (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {saveStatus === 'saving'
              ? 'Đang lưu câu này...'
              : saveStatus === 'queued'
                ? 'Đáp án đang chờ gửi'
                : saveStatus === 'error'
                  ? 'Câu này chưa lưu thành công'
                  : selected.length
                    ? 'Đáp án đã được lưu'
                    : 'Chưa chọn đáp án'}
          </p>
        </div>
        <div className="flex flex-wrap justify-between gap-3">
          <Button
            variant="outline"
            className="h-auto min-h-11 max-w-full whitespace-normal py-2.5"
            onClick={onPrevious}
            disabled={index === 0}
          >
            Câu trước
          </Button>
          <Button
            variant="outline"
            className="ml-auto h-auto min-h-11 max-w-full whitespace-normal py-2.5"
            onClick={onNext}
            disabled={index === total - 1}
          >
            Câu tiếp
          </Button>
        </div>
      </Card>
    );
  },
);

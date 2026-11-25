import { Check, CircleCheck } from 'lucide-react';
import { resultLabel, type ResultQuestion } from './result-model';

export function ResultQuestionCard({
  question,
  index,
}: {
  question: ResultQuestion;
  index: number;
}) {
  return (
    <details className="group rounded-xl border bg-card p-5 sm:p-6">
      <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
        <span>Câu {index + 1}</span>
        <span className="ml-3 text-sm text-muted-foreground">
          {resultLabel(question)} ·{' '}
          {question.earnedPoints.toLocaleString('vi-VN')} /{' '}
          {question.points.toLocaleString('vi-VN')} điểm
        </span>
      </summary>
      <p className="mt-5 whitespace-pre-wrap break-words text-base leading-7">
        {question.content}
      </p>
      <ul className="mt-5 space-y-3">
        {question.options.map((option) => {
          const chosen = question.selectedOptionIds.includes(option.id);
          return (
            <li
              key={option.id}
              className={`rounded-lg border p-4 ${option.isCorrect ? 'border-success/30 bg-success/5' : chosen ? 'border-destructive/25 bg-destructive/5' : 'border-border'}`}
            >
              <p className="whitespace-pre-wrap break-words leading-7">
                {option.content}
              </p>
              {(chosen || option.isCorrect) && (
                <p className="mt-2 flex flex-wrap gap-3 text-sm">
                  {chosen && (
                    <span className="inline-flex items-center gap-1.5 text-primary">
                      <Check className="size-4" aria-hidden="true" />
                      Bạn đã chọn
                    </span>
                  )}
                  {option.isCorrect && (
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <CircleCheck className="size-4" aria-hidden="true" />
                      Đáp án đúng
                    </span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {question.explanation !== null && (
        <div className="mt-5 rounded-lg bg-muted/60 p-4">
          <h3 className="font-medium">Lời giải</h3>
          <p className="mt-2 whitespace-pre-wrap break-words leading-7 text-muted-foreground">
            {question.explanation}
          </p>
        </div>
      )}
    </details>
  );
}

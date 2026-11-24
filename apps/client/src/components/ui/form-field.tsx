import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Label } from './label';

type FormFieldProps = ComponentProps<typeof Input> & {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  endAdornment?: ReactNode;
};

export function FormField({
  id,
  label,
  error,
  hint,
  endAdornment,
  className,
  ...props
}: FormFieldProps) {
  const description =
    [
      props['aria-describedby'],
      hint && !error ? `${id}-hint` : undefined,
      error ? `${id}-error` : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          {...props}
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={description}
          className={cn(endAdornment && 'pr-12', className)}
        />
        {endAdornment && (
          <div className="absolute inset-y-0 right-0 flex items-center">
            {endAdornment}
          </div>
        )}
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          className="text-sm leading-relaxed text-destructive"
        >
          {error}
        </p>
      ) : (
        hint && (
          <p
            id={`${id}-hint`}
            className="text-xs leading-relaxed text-muted-foreground"
          >
            {hint}
          </p>
        )
      )}
    </div>
  );
}

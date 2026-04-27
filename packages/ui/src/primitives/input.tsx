import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full h-10 px-3 rounded-[var(--radius-md)]',
        'bg-[var(--color-surface)] text-[var(--color-text)]',
        'border border-[var(--color-border)]',
        'placeholder:text-[var(--color-text-muted)]',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)]',
        invalid && 'border-[var(--color-danger)]',
        className,
      )}
      {...rest}
    />
  );
});

import type { LabelHTMLAttributes } from 'react';
import { cn } from '../cn';

export function Label({ className, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn('text-sm font-medium text-[var(--color-text)]', className)}
      {...rest}
    />
  );
}

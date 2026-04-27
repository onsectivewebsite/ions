import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-muted)]',
        className,
      )}
      {...rest}
    />
  );
}

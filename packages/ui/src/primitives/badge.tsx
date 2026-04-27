import type { HTMLAttributes } from 'react';
import { cn } from '../cn';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const toneStyles: Record<BadgeTone, string> = {
  neutral: 'bg-[var(--color-surface-muted)] text-[var(--color-text)]',
  success: 'bg-[color-mix(in_srgb,var(--color-success)_20%,transparent)] text-[var(--color-success)]',
  warning: 'bg-[color-mix(in_srgb,var(--color-warning)_20%,transparent)] text-[var(--color-warning)]',
  danger: 'bg-[color-mix(in_srgb,var(--color-danger)_20%,transparent)] text-[var(--color-danger)]',
  info: 'bg-[color-mix(in_srgb,var(--color-info)_20%,transparent)] text-[var(--color-info)]',
};

export function Badge({
  tone = 'neutral',
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-[var(--radius-pill)] px-2.5 py-0.5 text-xs font-medium',
        toneStyles[tone],
        className,
      )}
      {...rest}
    />
  );
}

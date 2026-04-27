import type { LucideIcon } from 'lucide-react';
import { cn } from '@onsecboad/ui';

export function StatCard({
  label,
  value,
  delta,
  icon: Icon,
  tone = 'primary',
  className,
}: {
  label: string;
  value: string | number;
  delta?: { value: string; positive?: boolean };
  icon?: LucideIcon;
  tone?: 'primary' | 'accent' | 'success' | 'info' | 'warning';
  className?: string;
}) {
  const toneVar = `var(--color-${tone === 'primary' ? 'primary' : tone})`;
  return (
    <div
      className={cn(
        'rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5',
        'transition-all hover:shadow-[var(--shadow-md)]',
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            {label}
          </div>
          <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-[var(--color-text)]">
            {value}
          </div>
          {delta ? (
            <div
              className={cn(
                'mt-1 text-xs font-medium',
                delta.positive ? 'text-[var(--color-success)]' : 'text-[var(--color-text-muted)]',
              )}
            >
              {delta.value}
            </div>
          ) : null}
        </div>
        {Icon ? (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)]"
            style={{
              backgroundColor: `color-mix(in srgb, ${toneVar} 14%, transparent)`,
              color: toneVar,
            }}
          >
            <Icon size={18} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

'use client';
import { THEME_LIST, type ThemeCode } from '@onsecboad/config/themes';
import { cn } from '../cn';

export function ThemeSwatchGrid({
  selected,
  onSelect,
}: {
  selected: ThemeCode;
  onSelect: (code: ThemeCode) => void;
}) {
  const codes: ThemeCode[] = [...THEME_LIST.map((t) => t.code), 'custom'];
  return (
    <div className="grid grid-cols-7 gap-3">
      {codes.map((code) => {
        const preset = THEME_LIST.find((t) => t.code === code);
        const primary = preset?.tokens.color.primary ?? '#9ca3af';
        const surface = preset?.tokens.color.surface ?? '#ffffff';
        const isSelected = selected === code;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(code)}
            className={cn(
              'flex flex-col items-stretch overflow-hidden rounded-[var(--radius-md)] border-2 transition-all',
              isSelected
                ? 'border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20'
                : 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]',
            )}
          >
            <div className="h-10" style={{ background: primary }} />
            <div className="h-6" style={{ background: surface }} />
            <div className="border-t border-[var(--color-border)] py-1 text-center text-xs font-medium">
              {code === 'custom' ? 'Custom' : preset?.name}
            </div>
          </button>
        );
      })}
    </div>
  );
}

'use client';
import { Eye, EyeOff } from 'lucide-react';
import { useState, type InputHTMLAttributes } from 'react';

/**
 * Password input with built-in show/hide toggle. Drop-in replacement for
 * <input type="password"> across all auth forms (sign-in, reset, invite,
 * setup wizard, profile change).
 */
export function PasswordField({
  className = '',
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        type={show ? 'text' : 'password'}
        className={
          'h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] pl-3 pr-10 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-focus)] ' +
          className
        }
      />
      <button
        type="button"
        aria-label={show ? 'Hide password' : 'Show password'}
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export type PasswordPolicyResult = {
  score: 0 | 1 | 2 | 3 | 4;
  passes: { length: boolean; mixedCase: boolean; digit: boolean; symbol: boolean };
  meetsPolicy: boolean;
  label: 'too short' | 'weak' | 'fair' | 'good' | 'strong';
};

/** Policy: ≥8 chars, mixed case, ≥1 digit. Symbol bumps the meter. */
export function checkPassword(pw: string): PasswordPolicyResult {
  const passes = {
    length: pw.length >= 8,
    mixedCase: /[a-z]/.test(pw) && /[A-Z]/.test(pw),
    digit: /[0-9]/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
  const meetsPolicy = passes.length && passes.mixedCase && passes.digit;
  const tally =
    Number(passes.length) + Number(passes.mixedCase) + Number(passes.digit) + Number(passes.symbol);
  const lengthBonus = pw.length >= 12 ? 1 : 0;
  const raw = Math.min(4, tally + lengthBonus - (passes.length ? 0 : 4));
  const score = Math.max(0, raw) as 0 | 1 | 2 | 3 | 4;
  const label = !passes.length
    ? ('too short' as const)
    : score <= 1
      ? ('weak' as const)
      : score === 2
        ? ('fair' as const)
        : score === 3
          ? ('good' as const)
          : ('strong' as const);
  return { score, passes, meetsPolicy, label };
}

const TONE: Record<PasswordPolicyResult['label'], { bar: string; text: string }> = {
  'too short': { bar: '#E5E5DF', text: '#6b7280' },
  weak: { bar: '#DC2626', text: '#B91C1C' },
  fair: { bar: '#F59E0B', text: '#B45309' },
  good: { bar: '#22C55E', text: '#15803D' },
  strong: { bar: '#15803D', text: '#15803D' },
};

export function PasswordStrengthMeter({ password }: { password: string }) {
  const r = checkPassword(password);
  if (!password) {
    return (
      <ul className="mt-2 space-y-1 text-[11px] text-[var(--color-text-muted)]">
        <li>· At least 8 characters</li>
        <li>· Upper and lower case letters</li>
        <li>· At least one number</li>
        <li>· (Optional) a symbol for extra strength</li>
      </ul>
    );
  }
  const tone = TONE[r.label];
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: i <= r.score ? tone.bar : '#E5E5DF' }}
          />
        ))}
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px]">
        <span style={{ color: tone.text, fontWeight: 600 }}>{r.label}</span>
        <span className="text-[var(--color-text-muted)]">
          {r.passes.length ? '✓' : '·'} 8+ chars · {r.passes.mixedCase ? '✓' : '·'} aA ·{' '}
          {r.passes.digit ? '✓' : '·'} 0-9 · {r.passes.symbol ? '✓' : '·'} symbol
        </span>
      </div>
    </div>
  );
}

import { cn } from '@onsecboad/ui';

export function Logo({
  size = 28,
  withWordmark = true,
  className,
  logoUrl,
  brandName,
}: {
  size?: number;
  withWordmark?: boolean;
  className?: string;
  /** Firm-uploaded logo. When set we render this instead of the OnsecBoad
   *  mark, and use brandName as the wordmark next to it. */
  logoUrl?: string | null;
  brandName?: string | null;
}) {
  if (logoUrl) {
    return (
      <span className={cn('inline-flex items-center gap-2.5', className)}>
        <img
          src={logoUrl}
          alt={brandName ?? 'Firm logo'}
          width={size}
          height={size}
          className="rounded-[var(--radius-md)] object-contain"
          style={{ width: size, height: size }}
        />
        {withWordmark && brandName ? (
          <span className="truncate text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
            {brandName}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
      >
        <defs>
          <linearGradient id="onsec-mark-grad" x1="4" y1="4" x2="28" y2="28" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--color-primary)" />
            <stop offset="1" stopColor="var(--color-accent)" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#onsec-mark-grad)" />
        <path
          d="M10.5 11h6.5a4.5 4.5 0 0 1 4.5 4.5v.5a4.5 4.5 0 0 1-4.5 4.5h-3a1.5 1.5 0 1 0 0 3H21"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      {withWordmark ? (
        <span className="text-[15px] font-semibold tracking-tight text-[var(--color-text)]">
          {brandName ?? 'OnsecBoad'}
        </span>
      ) : null}
    </span>
  );
}

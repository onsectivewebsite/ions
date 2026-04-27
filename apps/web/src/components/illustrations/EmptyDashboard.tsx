export function EmptyDashboard({ width = 240 }: { width?: number }) {
  return (
    <svg
      width={width}
      viewBox="0 0 320 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="empty-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-surface)" />
          <stop offset="1" stopColor="var(--color-surface-muted)" />
        </linearGradient>
      </defs>
      <rect x="20" y="30" width="280" height="150" rx="12" fill="url(#empty-grad)" stroke="var(--color-border)" />
      <rect x="40" y="50" width="80" height="10" rx="4" fill="var(--color-border)" />
      <rect x="40" y="68" width="140" height="6" rx="3" fill="var(--color-border-muted)" />
      <g opacity="0.7">
        <rect x="40" y="92" width="60" height="60" rx="8" fill="var(--color-primary)" opacity="0.12" />
        <rect x="110" y="92" width="60" height="60" rx="8" fill="var(--color-accent)" opacity="0.12" />
        <rect x="180" y="92" width="60" height="60" rx="8" fill="var(--color-info)" opacity="0.12" />
      </g>
      <circle cx="280" cy="140" r="22" fill="var(--color-primary)" opacity="0.9" />
      <path d="M271 140l7 7 12-14" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

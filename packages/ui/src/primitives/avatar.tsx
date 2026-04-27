import { cn } from '../cn';

const PALETTE = [
  '#B5132B', '#1E40AF', '#15803D', '#7C3AED', '#0EA5E9',
  '#A16207', '#BE185D', '#475569', '#0F766E', '#9333EA',
];

function colorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function Avatar({
  name,
  src,
  size = 36,
  className,
}: {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        width={size}
        height={size}
        className={cn('rounded-[var(--radius-pill)] object-cover', className)}
      />
    );
  }
  const bg = colorFor(name);
  return (
    <span
      aria-label={name}
      className={cn(
        'inline-flex items-center justify-center rounded-[var(--radius-pill)] font-semibold text-white',
        className,
      )}
      style={{ width: size, height: size, fontSize: size * 0.4, backgroundColor: bg }}
    >
      {initials(name)}
    </span>
  );
}

import { cn } from '../cn';

export function Spinner({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}

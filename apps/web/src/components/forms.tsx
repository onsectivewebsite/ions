'use client';
import type { ReactNode } from 'react';
import { Label } from '@onsecboad/ui';

/**
 * Label with an optional red asterisk. Use everywhere required fields
 * land so the asterisk convention is consistent across the app.
 */
export function FieldLabel({
  children,
  htmlFor,
  required,
  className = 'mb-1 block',
}: {
  children: ReactNode;
  htmlFor?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <Label htmlFor={htmlFor} className={className}>
      <span className="inline-flex items-center gap-1">
        {children}
        {required ? (
          <span aria-hidden className="text-[var(--color-danger)]">
            *
          </span>
        ) : null}
      </span>
    </Label>
  );
}

/** Inline error text for a single field. Renders nothing when message is empty. */
export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div className="mt-1 text-[11px] text-[var(--color-danger)]" role="alert">
      {message}
    </div>
  );
}

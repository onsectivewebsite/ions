'use client';
import Link from 'next/link';
import { ArrowLeft, FileWarning } from 'lucide-react';
import { Button, Card, CardBody, CardTitle } from '@onsecboad/ui';

/**
 * In-shell "this thing doesn't exist" panel. Used by detail pages
 * (leads, cases, clients) instead of an eternal skeleton when the
 * lookup returns NOT_FOUND.
 */
export function NotFoundPanel({
  title,
  message,
  backHref,
  backLabel,
}: {
  title: string;
  message: string;
  backHref: string;
  backLabel: string;
}) {
  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
            <FileWarning size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <CardTitle>{title}</CardTitle>
            <CardBody className="mt-1 text-sm text-[var(--color-text-muted)]">
              {message}
            </CardBody>
            <div className="mt-4">
              <Link href={backHref}>
                <Button variant="secondary" size="sm">
                  <ArrowLeft size={14} />
                  {backLabel}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

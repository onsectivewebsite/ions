'use client';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { Button } from '@onsecboad/ui';
import { Logo } from '../Logo';
import { rpcMutation } from '../../lib/api';
import { getPortalToken, setPortalToken } from '../../lib/portal-session';

/**
 * Minimal shell for the client portal — single column layout, no
 * sidebar, friendly to mobile. Header carries the firm name + sign-out
 * button. The signed-in client is the full attention.
 */
export function PortalShell({
  firmName,
  clientName,
  children,
}: {
  firmName: string;
  clientName: string;
  children: ReactNode;
}) {
  const router = useRouter();

  async function signOut(): Promise<void> {
    const t = getPortalToken();
    try {
      await rpcMutation('portal.signOut', undefined, { token: t });
    } catch {
      /* ignore */
    }
    setPortalToken(null);
    router.replace('/portal/sign-in');
  }

  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-surface)_92%,transparent)] px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="hidden text-xs text-[var(--color-text-muted)] sm:inline">
              {firmName} · client portal
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/portal/dashboard"
              className="hidden text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:inline"
            >
              Files
            </Link>
            <Link
              href="/portal/invoices"
              className="hidden text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:inline"
            >
              Invoices
            </Link>
            <Link
              href="/portal/payments"
              className="hidden text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:inline"
            >
              Payments
            </Link>
            <span className="text-xs text-[var(--color-text-muted)]">{clientName}</span>
            <Button size="sm" variant="ghost" onClick={signOut}>
              <LogOut size={12} /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8">{children}</main>
    </div>
  );
}

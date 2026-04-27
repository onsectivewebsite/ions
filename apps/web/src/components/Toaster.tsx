'use client';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { Bell, MessageSquare, PhoneCall, X } from 'lucide-react';
import { useRealtime, type RealtimeEvent } from '../lib/realtime';

type Toast = {
  id: string;
  icon: ReactNode;
  title: string;
  body: string;
  href?: string;
  /** ms before auto-dismiss; 0 = sticky */
  ttlMs?: number;
};

/**
 * Tiny in-app toaster that listens to the realtime stream and surfaces
 * the events that matter to the current user. Mount this at the layout
 * level (it self-positions fixed bottom-right).
 *
 * Why not a third-party lib (sonner / react-hot-toast)? We render fewer
 * than a dozen toasts a session, the API is small, and we keep our
 * dependency surface tight.
 */
export function Toaster(): ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useRealtime((ev: RealtimeEvent) => {
    const t = mapEventToToast(ev);
    if (!t) return;
    setToasts((prev) => [...prev, t]);
    if (t.ttlMs && t.ttlMs > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, t.ttlMs);
    }
  });

  // Cap to 4 visible — drop oldest.
  useEffect(() => {
    if (toasts.length > 4) {
      setToasts((prev) => prev.slice(prev.length - 4));
    }
  }, [toasts.length]);

  function dismiss(id: string): void {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }

  if (toasts.length === 0) return <></>;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => {
        const inner = (
          <div
            key={t.id}
            className="pointer-events-auto flex w-80 items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
              {t.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">{t.title}</div>
              <div className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">
                {t.body}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                dismiss(t.id);
              }}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
        return t.href ? (
          <Link key={t.id} href={t.href} onClick={() => dismiss(t.id)} className="no-underline">
            {inner}
          </Link>
        ) : (
          <div key={t.id}>{inner}</div>
        );
      })}
    </div>
  );
}

function mapEventToToast(ev: RealtimeEvent): Toast | null {
  switch (ev.type) {
    case 'lead.assigned': {
      const name =
        [ev.firstName, ev.lastName].filter(Boolean).join(' ') || ev.phone || 'New lead';
      return {
        id: `la-${ev.leadId}-${Date.now()}`,
        icon: <Bell size={16} />,
        title: 'New lead assigned',
        body: name,
        href: `/leads/${ev.leadId}`,
        ttlMs: 8000,
      };
    }
    case 'sms.received': {
      return {
        id: `sm-${ev.smsId}`,
        icon: <MessageSquare size={16} />,
        title: `SMS from ${ev.from}`,
        body: ev.bodyPreview,
        href: ev.leadId ? `/leads/${ev.leadId}` : undefined,
        ttlMs: 8000,
      };
    }
    case 'call.status': {
      // Only surface terminal statuses (completed / no-answer / busy / failed).
      if (!['completed', 'no-answer', 'busy', 'failed'].includes(ev.status)) return null;
      return {
        id: `cs-${ev.callId}-${ev.status}`,
        icon: <PhoneCall size={16} />,
        title: `Call ${ev.status}`,
        body: ev.leadId ? 'Tap to open the lead' : '',
        href: ev.leadId ? `/leads/${ev.leadId}` : undefined,
        ttlMs: 5000,
      };
    }
    default:
      return null;
  }
}

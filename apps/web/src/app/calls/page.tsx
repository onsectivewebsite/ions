'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Phone, PhoneIncoming, PhoneOutgoing } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';

type CallRow = {
  id: string;
  direction: 'outbound' | 'inbound';
  status: string;
  fromNumber: string | null;
  toNumber: string | null;
  durationSec: number | null;
  disposition: string | null;
  startedAt: string;
  endedAt: string | null;
  lead: { id: string; firstName: string | null; lastName: string | null; phone: string | null } | null;
  agent: { id: string; name: string; email: string } | null;
};

type ListResp = { items: CallRow[]; total: number; page: number; pageSize: number };

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger' | 'info'> = {
  completed: 'success',
  ringing: 'info',
  'in-progress': 'info',
  queued: 'neutral',
  busy: 'warning',
  'no-answer': 'warning',
  failed: 'danger',
};

function formatDuration(s: number | null): string {
  if (!s && s !== 0) return '—';
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, '0')}`;
}

function leadName(lead: CallRow['lead']): string {
  if (!lead) return '—';
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.phone || '—';
}

export default function CallsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resp, setResp] = useState<ListResp | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then((m) => {
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
      })
      .catch(() => router.replace('/sign-in'));
  }, [router]);

  useEffect(() => {
    if (!me) return;
    const token = getAccessToken();
    if (!token) return;
    setResp(null);
    rpcQuery<ListResp>('call.list', { page, mine: mineOnly || undefined }, { token })
      .then(setResp)
      .catch(() => setResp({ items: [], total: 0, page: 1, pageSize: 50 }));
  }, [me, page, mineOnly]);

  const totalPages = useMemo(
    () => (resp ? Math.max(1, Math.ceil(resp.total / resp.pageSize)) : 1),
    [resp],
  );

  if (!me) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Firm</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Call history</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Every call logged via the lead detail Call button. Inbound calls land here when
              your Twilio phone-number webhook is wired.
            </p>
          </div>

          <Card>
            <div className="flex items-center gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={mineOnly}
                  onChange={(e) => {
                    setMineOnly(e.target.checked);
                    setPage(1);
                  }}
                />
                Mine only
              </label>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Lead / Number</th>
                    <th className="py-2 pr-4">Agent</th>
                    <th className="py-2 pr-4">Direction</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Duration</th>
                    <th className="py-2 pr-4">Disposition</th>
                    <th className="py-2 pr-4">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {resp === null ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-muted)]">
                        <td colSpan={7} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : resp.items.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                          <Phone size={20} />
                        </div>
                        <div className="text-sm font-medium">No calls yet</div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          Open a lead and click <span className="font-medium">Call</span> to log your first one.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    resp.items.map((c) => (
                      <tr key={c.id} className="border-b border-[var(--color-border-muted)]">
                        <td className="py-3 pr-4">
                          {c.lead ? (
                            <Link href={`/leads/${c.lead.id}`} className="font-medium hover:underline">
                              {leadName(c.lead)}
                            </Link>
                          ) : (
                            <span>{c.toNumber ?? c.fromNumber ?? '—'}</span>
                          )}
                          <div className="text-[10px] text-[var(--color-text-muted)]">
                            {c.direction === 'outbound' ? c.toNumber : c.fromNumber}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                          {c.agent?.name ?? 'System'}
                        </td>
                        <td className="py-3 pr-4">
                          {c.direction === 'outbound' ? (
                            <span className="inline-flex items-center gap-1 text-xs">
                              <PhoneOutgoing size={11} /> Outbound
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs">
                              <PhoneIncoming size={11} /> Inbound
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status}</Badge>
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs">{formatDuration(c.durationSec)}</td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {c.disposition ?? '—'}
                        </td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {new Date(c.startedAt).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {resp && resp.total > resp.pageSize ? (
              <div className="mt-4 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                <div>
                  {resp.total} calls · page {page} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

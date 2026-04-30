'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Inbox, Shield } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  Input,
  Label,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { AppShell, type ShellUser } from '../../components/AppShell';

type Me = {
  kind: 'platform' | 'firm';
  name: string;
  email: string;
  tenant?: { displayName: string; branding: Branding };
};

type AuditRow = {
  id: string;
  tenantId: string | null;
  actorId: string | null;
  actorType: 'PLATFORM' | 'USER' | 'CLIENT' | 'SYSTEM';
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
};

type ListResp = { items: AuditRow[]; total: number; page: number; pageSize: number };

const ACTOR_TONE: Record<AuditRow['actorType'], 'success' | 'info' | 'neutral' | 'warning' | 'danger'> = {
  PLATFORM: 'danger',
  USER: 'info',
  CLIENT: 'success',
  SYSTEM: 'neutral',
};

export default function PlatformAuditPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resp, setResp] = useState<ListResp | null>(null);
  const [page, setPage] = useState(1);
  const [tenantId, setTenantId] = useState('');
  const [action, setAction] = useState('');
  const [actorType, setActorType] = useState<'' | AuditRow['actorType']>('');

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then((m) => {
        if (m.kind !== 'platform') {
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
    rpcQuery<ListResp>(
      'platform.audit.list',
      {
        page,
        tenantId: tenantId || undefined,
        action: action || undefined,
        actorType: actorType || undefined,
      },
      { token },
    )
      .then(setResp)
      .catch(() => setResp({ items: [], total: 0, page: 1, pageSize: 50 }));
  }, [me, page, tenantId, action, actorType]);

  const totalPages = useMemo(
    () => (resp ? Math.max(1, Math.ceil(resp.total / resp.pageSize)) : 1),
    [resp],
  );

  if (!me) {
    return (
      <main className="grid min-h-screen md:grid-cols-[240px_1fr]">
        <div className="hidden border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:block">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-4 sm:p-8">
          <Skeleton className="h-12" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding: Branding = { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'platform',
    contextLabel: 'Onsective Platform',
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Platform</div>
            <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight">
              <Shield size={20} />
              Audit log
            </h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Every privileged action across every firm. Cross-tenant; filter by tenant ID,
              action, or actor type.
            </p>
          </div>

          <Card>
            <CardTitle>Filters</CardTitle>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <Label className="mb-1 block text-xs">Tenant ID</Label>
                <Input
                  placeholder="UUID (paste from /p/firms)"
                  value={tenantId}
                  onChange={(e) => {
                    setTenantId(e.target.value.trim());
                    setPage(1);
                  }}
                  className="font-mono text-xs"
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Action contains</Label>
                <Input
                  placeholder="e.g. tenant.suspend"
                  value={action}
                  onChange={(e) => {
                    setAction(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Actor type</Label>
                <select
                  value={actorType}
                  onChange={(e) => {
                    setActorType(e.target.value as typeof actorType);
                    setPage(1);
                  }}
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                >
                  <option value="">All</option>
                  <option value="PLATFORM">Platform admin</option>
                  <option value="USER">Firm staff</option>
                  <option value="CLIENT">Client portal</option>
                  <option value="SYSTEM">System / cron</option>
                </select>
              </div>
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <CardTitle>
                {resp ? `${resp.total.toLocaleString()} events` : 'Loading…'}
              </CardTitle>
              {resp && resp.total > 0 ? (
                <CardBody className="text-xs text-[var(--color-text-muted)]">
                  Page {resp.page} of {totalPages}
                </CardBody>
              ) : null}
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">When</th>
                    <th className="py-2 pr-4">Tenant</th>
                    <th className="py-2 pr-4">Actor</th>
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Target</th>
                    <th className="py-2 pr-4">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {resp === null ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-muted)]">
                        <td colSpan={6} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : resp.items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                          <Inbox size={20} />
                        </div>
                        <div className="text-sm font-medium">No audit events match.</div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          Adjust filters or wait for activity to flow in.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    resp.items.map((r) => (
                      <tr
                        key={r.id}
                        className="border-b border-[var(--color-border-muted)] hover:bg-[var(--color-surface-muted)]/40"
                      >
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)] tabular-nums">
                          {new Date(r.createdAt).toLocaleString()}
                        </td>
                        <td className="py-3 pr-4 font-mono text-[10px] text-[var(--color-text-muted)]">
                          {r.tenantId ? r.tenantId.slice(0, 8) : '—'}
                        </td>
                        <td className="py-3 pr-4">
                          <Badge tone={ACTOR_TONE[r.actorType]}>{r.actorType}</Badge>
                        </td>
                        <td className="py-3 pr-4 font-mono text-xs">{r.action}</td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {r.targetType ?? '—'}
                          {r.targetId ? (
                            <span className="ml-1 font-mono text-[10px] opacity-60">
                              {r.targetId.slice(0, 8)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {r.ip ?? '—'}
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
                  {resp.total} total · page {page} of {totalPages}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
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

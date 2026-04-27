'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { History, Search } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Input,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type AuditRow = {
  id: string;
  action: string;
  actorType: 'PLATFORM' | 'USER' | 'CLIENT' | 'SYSTEM';
  targetType: string;
  targetId: string | null;
  payload: unknown;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string | null };
};

type ListResp = {
  items: AuditRow[];
  total: number;
  page: number;
  pageSize: number;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const ACTOR_TONE: Record<AuditRow['actorType'], 'success' | 'info' | 'warning' | 'neutral'> = {
  USER: 'success',
  PLATFORM: 'info',
  SYSTEM: 'warning',
  CLIENT: 'neutral',
};

export default function AuditPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resp, setResp] = useState<ListResp | null>(null);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState<'' | AuditRow['actorType']>('');
  const [error, setError] = useState<string | null>(null);

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
    rpcQuery<ListResp>(
      'audit.list',
      {
        page,
        action: actionFilter || undefined,
        actorType: actorFilter || undefined,
      },
      { token },
    )
      .then(setResp)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load'));
  }, [me, page, actionFilter, actorFilter]);

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
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Audit log</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Every administrative action in your firm — user invites, role changes, billing edits, and
              security events.
            </p>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[260px] flex-1">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]"
                />
                <Input
                  value={actionFilter}
                  onChange={(e) => {
                    setActionFilter(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Filter by action (e.g. user.invite, role.update)…"
                  className="pl-9 font-mono"
                />
              </div>
              <select
                value={actorFilter}
                onChange={(e) => {
                  setActorFilter(e.target.value as typeof actorFilter);
                  setPage(1);
                }}
                className="h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="">All actors</option>
                <option value="USER">Users</option>
                <option value="PLATFORM">Onsective platform</option>
                <option value="SYSTEM">System</option>
                <option value="CLIENT">Clients</option>
              </select>
            </div>

            <div className="mt-4 divide-y divide-[var(--color-border-muted)]">
              {resp === null ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="py-3">
                    <Skeleton className="h-12" />
                  </div>
                ))
              ) : resp.items.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                    <History size={20} />
                  </div>
                  <div className="text-sm font-medium">No audit entries match these filters</div>
                </div>
              ) : (
                resp.items.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 py-3">
                    <Badge tone={ACTOR_TONE[a.actorType]}>{a.actorType}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-2 text-sm">
                        <code className="font-mono">{a.action}</code>
                        <span className="text-xs text-[var(--color-text-muted)]">
                          on {a.targetType}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                        {a.actor.name}
                        {a.actor.email ? ` (${a.actor.email})` : ''}
                        {a.ip ? ` · ${a.ip}` : ''}
                      </div>
                      {a.payload ? (
                        <details className="mt-2 text-xs">
                          <summary className="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                            Payload
                          </summary>
                          <pre className="mt-1 max-w-full overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2 font-mono text-[10px]">
                            {JSON.stringify(a.payload, null, 2)}
                          </pre>
                        </details>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-xs text-[var(--color-text-muted)]">
                      {new Date(a.createdAt).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>

            {resp && resp.total > resp.pageSize ? (
              <div className="mt-4 flex items-center justify-between text-xs text-[var(--color-text-muted)]">
                <div>
                  {resp.total} entries · page {page} of {totalPages}
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

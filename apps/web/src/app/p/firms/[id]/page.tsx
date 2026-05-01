'use client';
import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Copy,
  Mail,
  Pause,
  Pencil,
  Phone,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { Badge, Button, Card, CardBody, CardTitle, Input, Label, Skeleton, Spinner, ThemeProvider } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getAccessToken, setAccessToken } from '../../../../lib/session';
import { AppShell, type ShellUser } from '../../../../components/AppShell';

type TenantStatus = 'PROVISIONING' | 'ACTIVE' | 'SUSPENDED' | 'CANCELED';

type Address = {
  line1?: string;
  line2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  country?: string;
} | null;

type Firm = {
  id: string;
  legalName: string;
  displayName: string;
  slug: string;
  status: TenantStatus;
  packageTier: 'STARTER' | 'GROWTH' | 'SCALE';
  seatCount: number;
  createdAt: string;
  trialEndsAt: string | null;
  setupCompletedAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  address: Address;
  taxId: string | null;
  taxIdType: string | null;
  plan: { code: string; name: string; pricePerSeatCents: number } | null;
  users: Array<{
    id: string;
    name: string;
    email: string;
    status: string;
    invitedAt: string | null;
    joinedAt: string | null;
    lastLoginAt: string | null;
    role: { id: string; name: string };
    branch: { name: string } | null;
  }>;
  branches: Array<{ id: string; name: string; phone: string }>;
  _count: { users: number; branches: number; invoices: number };
};

function formatAddress(a: Address): string {
  if (!a) return '—';
  const lines = [
    a.line1,
    a.line2,
    [a.city, a.province, a.postalCode].filter(Boolean).join(', '),
    a.country,
  ].filter(Boolean);
  return lines.length ? lines.join(' · ') : '—';
}

const TAX_LABEL: Record<string, string> = {
  ca_gst_hst: 'GST/HST',
  ca_pst_bc: 'BC PST',
  ca_pst_mb: 'MB PST',
  ca_pst_sk: 'SK PST',
  ca_qst: 'QC QST',
  us_ein: 'EIN',
  eu_vat: 'EU VAT',
  gb_vat: 'GB VAT',
  in_gst: 'India GST',
};

type Me = { kind: 'platform'; name: string; email: string };

const STATUS_TONE: Record<TenantStatus, 'success' | 'neutral' | 'warning' | 'danger'> = {
  ACTIVE: 'success',
  PROVISIONING: 'neutral',
  SUSPENDED: 'warning',
  CANCELED: 'danger',
};

export default function FirmDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [firm, setFirm] = useState<Firm | null>(null);
  const [tab, setTab] = useState<'overview' | 'subscription' | 'users' | 'ai' | 'activity'>('overview');
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editAdminId, setEditAdminId] = useState<string | null>(null);
  type AuditRow = {
    id: string;
    action: string;
    actorType: string;
    targetType: string;
    payload: unknown;
    createdAt: string;
  };
  const [audit, setAudit] = useState<AuditRow[] | null>(null);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    try {
      const data = await rpcQuery<Firm>('platform.tenant.get', { id }, { token });
      setFirm(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    }
  }

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
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (tab !== 'activity') return;
    const token = getAccessToken();
    if (!token) return;
    rpcQuery<{ items: AuditRow[] }>('platform.audit.byTenant', { tenantId: id, page: 1 }, { token })
      .then((r) => setAudit(r.items))
      .catch(() => setAudit([]));
  }, [tab, id]);

  async function action(
    label: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    setBusy(true);
    setInfo(null);
    setError(null);
    try {
      await fn();
      setInfo(label);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setBusy(false);
    }
  }

  async function impersonate(userId: string): Promise<void> {
    if (typeof window === 'undefined') return;
    if (
      !confirm(
        "You're about to sign in as this firm user. Every action is logged against your platform-admin account. Continue?",
      )
    )
      return;
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{
        accessToken: string;
        target: { tenantName: string; name: string; email: string };
      }>('platform.tenant.impersonate', { userId }, { token });
      // Replace token in browser storage and reload into the firm's
      // dashboard. The minted JWT carries `impersonator` so the firm
      // shell will show a banner.
      sessionStorage.setItem(
        'onsec.impersonating',
        JSON.stringify({
          target: r.target,
          startedAt: new Date().toISOString(),
        }),
      );
      setAccessToken(r.accessToken);
      window.location.href = '/dashboard';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impersonate failed');
    }
  }

  async function forcePasswordReset(userId: string, email: string): Promise<void> {
    if (typeof window === 'undefined') return;
    if (
      !confirm(
        `Force password reset for ${email}? They'll receive a reset email; their current password stops working when they pick a new one.`,
      )
    )
      return;
    try {
      const token = getAccessToken();
      const r = await rpcMutation<{ emailSent: boolean; emailError: string | null; resetUrl: string }>(
        'platform.user.forcePasswordReset',
        { userId },
        { token },
      );
      if (r.emailSent) {
        setInfo(`Reset email sent to ${email}.`);
      } else {
        // SMTP failure — fall back to copy-paste of the URL.
        await navigator.clipboard.writeText(r.resetUrl);
        setInfo(
          `Email failed (${r.emailError ?? 'unknown'}). Reset URL copied to clipboard — send it manually.`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    }
  }

  async function extendTrial(): Promise<void> {
    if (typeof window === 'undefined' || !firm) return;
    const days = window.prompt('Extend trial by how many days? (1–90)', '14');
    if (!days) return;
    const reason = window.prompt('Reason (logged):', 'Customer requested extra time');
    if (!reason) return;
    void action(`Trial extended by ${days} days.`, async () => {
      const token = getAccessToken();
      return rpcMutation(
        'platform.tenant.extendTrial',
        { tenantId: firm.id, days: Number(days), reason },
        { token },
      );
    });
  }

  if (!me || !firm) {
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

  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'platform',
    contextLabel: 'Onsective Platform',
  };

  const token = (): string => getAccessToken() ?? '';
  const mrr = firm.plan
    ? `$${((firm.seatCount * firm.plan.pricePerSeatCents) / 100).toLocaleString('en-CA')}`
    : '—';

  return (
    <ThemeProvider branding={{ themeCode: 'maple' }}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <Link
            href="/p/firms"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to firms
          </Link>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{firm.displayName}</h1>
              <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <span className="font-mono">{firm.slug}.onsecboad.com</span>
                <span>·</span>
                <span>{firm.legalName}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[firm.status]}>● {firm.status}</Badge>
              <Badge tone="neutral">{firm.packageTier}</Badge>
            </div>
          </div>

          {info ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]">
              {info}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <div className="border-b border-[var(--color-border-muted)]">
            <nav className="flex gap-1">
              {(['overview', 'subscription', 'users', 'ai', 'activity'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={
                    'border-b-2 px-3 py-2 text-sm font-medium capitalize transition-colors ' +
                    (tab === t
                      ? 'border-[var(--color-primary)] text-[var(--color-text)]'
                      : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]')
                  }
                >
                  {t}
                </button>
              ))}
            </nav>
          </div>

          {tab === 'overview' ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
              <div className="space-y-6">
                <Card>
                  <div className="flex items-center justify-between">
                    <CardTitle>Overview</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)}>
                      <Pencil size={12} /> Edit
                    </Button>
                  </div>
                  <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                    <Row label="Plan">{firm.plan?.name ?? '—'}</Row>
                    <Row label="MRR (CAD)">{mrr}</Row>
                    <Row label="Seats">{firm.seatCount}</Row>
                    <Row label="Branches">{firm._count.branches}</Row>
                    <Row label="Created">{new Date(firm.createdAt).toLocaleDateString()}</Row>
                    <Row label="Trial ends">
                      {firm.trialEndsAt ? new Date(firm.trialEndsAt).toLocaleDateString() : '—'}
                    </Row>
                    <Row label="Setup">
                      {firm.setupCompletedAt
                        ? `Completed ${new Date(firm.setupCompletedAt).toLocaleDateString()}`
                        : 'Pending'}
                    </Row>
                    <Row label="Stripe customer">
                      <code className="text-xs">{firm.stripeCustomerId ?? '—'}</code>
                    </Row>
                  </dl>
                </Card>

                <Card>
                  <div className="flex items-center justify-between">
                    <CardTitle>Firm administrators</CardTitle>
                    <ShieldCheck size={16} className="text-[var(--color-text-muted)]" />
                  </div>
                  {(() => {
                    const admins = firm.users.filter((u) => u.role.name === 'FIRM_ADMIN');
                    if (admins.length === 0) {
                      return (
                        <p className="mt-4 text-sm text-[var(--color-text-muted)]">
                          No FIRM_ADMIN user yet. Resend the setup email or invite one in Phase 2.
                        </p>
                      );
                    }
                    return (
                      <ul className="mt-4 divide-y divide-[var(--color-border-muted)]">
                        {admins.map((u) => (
                          <li key={u.id} className="py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-medium">{u.name}</span>
                                  <Badge tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>
                                    {u.status}
                                  </Badge>
                                </div>
                                <a
                                  href={`mailto:${u.email}`}
                                  className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:underline"
                                >
                                  <Mail size={11} />
                                  {u.email}
                                </a>
                                <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-text-muted)]">
                                  <CopyableId id={u.id} />
                                  {u.lastLoginAt ? (
                                    <span>· Last login {new Date(u.lastLoginAt).toLocaleDateString()}</span>
                                  ) : (
                                    <span>· Never signed in</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-col gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditAdminId(u.id)}
                                >
                                  <Pencil size={12} /> Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={u.status !== 'ACTIVE'}
                                  title={
                                    u.status !== 'ACTIVE'
                                      ? 'Only active users can be impersonated'
                                      : 'Sign in as this user — heavily audited'
                                  }
                                  onClick={() => impersonate(u.id)}
                                >
                                  Impersonate
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => forcePasswordReset(u.id, u.email)}
                                >
                                  Reset password
                                </Button>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </Card>

                <Card>
                  <CardTitle>Contact &amp; billing</CardTitle>
                  <dl className="mt-4 grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                    <Row label="Legal name">{firm.legalName}</Row>
                    <Row label="Contact name">{firm.contactName ?? '—'}</Row>
                    <Row label="Contact email">
                      {firm.contactEmail ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Mail size={12} className="text-[var(--color-text-muted)]" />
                          <a href={`mailto:${firm.contactEmail}`} className="hover:underline">
                            {firm.contactEmail}
                          </a>
                        </span>
                      ) : (
                        '—'
                      )}
                    </Row>
                    <Row label="Contact phone">
                      {firm.contactPhone ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone size={12} className="text-[var(--color-text-muted)]" />
                          <a href={`tel:${firm.contactPhone}`} className="hover:underline">
                            {firm.contactPhone}
                          </a>
                        </span>
                      ) : (
                        '—'
                      )}
                    </Row>
                    <div className="md:col-span-2">
                      <Row label="Billing address">{formatAddress(firm.address)}</Row>
                    </div>
                    <Row label="Tax ID">
                      {firm.taxId ? (
                        <span>
                          <span className="text-xs text-[var(--color-text-muted)]">
                            {firm.taxIdType ? TAX_LABEL[firm.taxIdType] ?? firm.taxIdType : 'Tax ID'}
                            {' · '}
                          </span>
                          <span className="font-mono">{firm.taxId}</span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </Row>
                  </dl>
                </Card>
              </div>

              <Card>
                <CardTitle>Actions</CardTitle>
                <div className="mt-4 grid gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => setEditOpen(true)}>
                    <Pencil size={14} /> Edit firm
                  </Button>
                  {firm.status === 'ACTIVE' || firm.status === 'PROVISIONING' ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        action('Firm suspended', () =>
                          rpcMutation('platform.tenant.suspend', { id }, { token: token() }),
                        )
                      }
                    >
                      <Pause size={14} /> Suspend
                    </Button>
                  ) : null}
                  {firm.status === 'SUSPENDED' ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        action('Firm resumed', () =>
                          rpcMutation('platform.tenant.resume', { id }, { token: token() }),
                        )
                      }
                    >
                      <Play size={14} /> Resume
                    </Button>
                  ) : null}
                  {!firm.setupCompletedAt ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setInfo(null);
                        setError(null);
                        try {
                          const r = await rpcMutation<{
                            ok: true;
                            setupUrl: string;
                            emailSent: boolean;
                            emailError?: string;
                          }>('platform.tenant.resendSetup', { id }, { token: token() });
                          if (r.emailSent) {
                            setInfo('Setup link resent to the firm admin.');
                          } else {
                            setError(`Email failed. Copy this link to share manually: ${r.setupUrl}`);
                          }
                          await refresh();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Resend failed');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <RefreshCw size={14} /> Resend setup email
                    </Button>
                  ) : null}
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() =>
                      action('Seats reconciled with Stripe', () =>
                        rpcMutation('platform.tenant.reconcileSeats', { id }, { token: token() }),
                      )
                    }
                  >
                    <RotateCcw size={14} /> Reconcile seats
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={extendTrial}>
                    Extend trial
                  </Button>
                  {firm.status !== 'CANCELED' ? (
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm('Cancel this subscription at period end?')) return;
                        void action('Subscription canceled at period end', () =>
                          rpcMutation(
                            'platform.tenant.cancel',
                            { id, immediate: false },
                            { token: token() },
                          ),
                        );
                      }}
                    >
                      <X size={14} /> Cancel
                    </Button>
                  ) : null}
                  <Button variant="danger" disabled={busy} onClick={() => setDeleteOpen(true)}>
                    <Trash2 size={14} /> Delete firm
                  </Button>
                </div>
              </Card>
            </div>
          ) : null}

          {tab === 'subscription' ? (
            <Card>
              <CardTitle>Subscription</CardTitle>
              <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <Row label="Plan">{firm.plan?.name ?? '—'}</Row>
                <Row label="Price / seat / mo">
                  {firm.plan ? `$${(firm.plan.pricePerSeatCents / 100).toFixed(0)} CAD` : '—'}
                </Row>
                <Row label="Seats">{firm.seatCount}</Row>
                <Row label="MRR">{mrr}</Row>
                <Row label="Stripe sub">
                  <code className="text-xs">{firm.stripeSubscriptionId ?? '—'}</code>
                </Row>
                <Row label="Trial ends">
                  {firm.trialEndsAt ? new Date(firm.trialEndsAt).toLocaleDateString() : '—'}
                </Row>
              </div>
              <div className="mt-6">
                <CardTitle>Change plan</CardTitle>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['STARTER', 'GROWTH', 'SCALE'] as const).map((code) => (
                    <Button
                      key={code}
                      size="sm"
                      variant={firm.packageTier === code ? 'primary' : 'secondary'}
                      disabled={busy || firm.packageTier === code}
                      onClick={() => {
                        if (!confirm(`Switch ${firm.displayName} to ${code}?`)) return;
                        void action(`Plan changed to ${code}`, () =>
                          rpcMutation(
                            'platform.tenant.changePlan',
                            { id, planCode: code },
                            { token: token() },
                          ),
                        );
                      }}
                    >
                      {code}
                    </Button>
                  ))}
                </div>
              </div>
            </Card>
          ) : null}

          {tab === 'users' ? (
            <Card>
              <CardTitle>Users ({firm._count.users})</CardTitle>
              <div className="mt-4 divide-y divide-[var(--color-border-muted)]">
                {firm.users.length === 0 ? (
                  <div className="py-12 text-center text-sm text-[var(--color-text-muted)]">
                    No users yet.
                  </div>
                ) : (
                  firm.users.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <div className="text-sm font-medium">{u.name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{u.email}</div>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <Badge tone="neutral">{u.role.name}</Badge>
                        {u.branch ? (
                          <span className="text-[var(--color-text-muted)]">@ {u.branch.name}</span>
                        ) : null}
                        <Badge tone={u.status === 'ACTIVE' ? 'success' : 'neutral'}>
                          {u.status}
                        </Badge>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>
          ) : null}

          {tab === 'ai' ? <AiUsageCard tenantId={firm.id} /> : null}

          {tab === 'overview' ? (
            <PlatformControlsCard
              tenantId={firm.id}
              flags={
                (firm as unknown as { featureFlags?: Record<string, boolean> }).featureFlags ??
                {}
              }
              announcement={
                (firm as unknown as {
                  announcement?: { message: string; level: 'info' | 'warning' | 'urgent' } | null;
                }).announcement ?? null
              }
              onChanged={() => void refresh()}
              onError={(m) => setError(m)}
            />
          ) : null}

          {tab === 'activity' ? (
            <Card>
              <CardTitle>Activity</CardTitle>
              {audit === null ? (
                <Skeleton className="mt-4 h-32" />
              ) : audit.length === 0 ? (
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                  No audit entries yet.
                </p>
              ) : (
                <ul className="mt-4 divide-y divide-[var(--color-border-muted)] text-sm">
                  {audit.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 py-3">
                      <div>
                        <div className="font-mono text-xs">{a.action}</div>
                        <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                          {a.actorType} · {a.targetType}
                          {a.payload ? ' · ' + JSON.stringify(a.payload).slice(0, 80) : ''}
                        </div>
                      </div>
                      <div className="shrink-0 text-xs text-[var(--color-text-muted)]">
                        {new Date(a.createdAt).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>

        {editOpen ? (
          <EditFirmDialog
            firm={firm}
            onClose={() => setEditOpen(false)}
            onSaved={async () => {
              setEditOpen(false);
              setInfo('Firm details updated.');
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {deleteOpen ? (
          <DeleteFirmDialog
            firm={firm}
            onClose={() => setDeleteOpen(false)}
            onDeleted={() => router.push('/p/firms')}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {editAdminId
          ? (() => {
              const admin = firm.users.find((u) => u.id === editAdminId);
              if (!admin) return null;
              return (
                <EditAdminDialog
                  user={admin}
                  tenantContactEmail={firm.contactEmail}
                  onClose={() => setEditAdminId(null)}
                  onSaved={async () => {
                    setEditAdminId(null);
                    setInfo('Firm admin updated.');
                    await refresh();
                  }}
                  onError={(msg) => setError(msg)}
                />
              );
            })()
          : null}
      </AppShell>
    </ThemeProvider>
  );
}

function CopyableId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      ID
      <code className="font-mono">{id.slice(0, 8)}…</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(id);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="rounded p-0.5 hover:bg-[var(--color-surface-muted)]"
        aria-label="Copy user id"
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
      </button>
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-xl">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>{title}</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </Card>
    </div>
  );
}

function EditFirmDialog({
  firm,
  onClose,
  onSaved,
  onError,
}: {
  firm: Firm;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [legalName, setLegalName] = useState(firm.legalName);
  const [displayName, setDisplayName] = useState(firm.displayName);
  const [contactName, setContactName] = useState(firm.contactName ?? '');
  const [contactEmail, setContactEmail] = useState(firm.contactEmail ?? '');
  const [contactPhone, setContactPhone] = useState(firm.contactPhone ?? '');
  const [line1, setLine1] = useState(firm.address?.line1 ?? '');
  const [line2, setLine2] = useState(firm.address?.line2 ?? '');
  const [city, setCity] = useState(firm.address?.city ?? '');
  const [province, setProvince] = useState(firm.address?.province ?? '');
  const [postalCode, setPostalCode] = useState(firm.address?.postalCode ?? '');
  const [country, setCountry] = useState(firm.address?.country ?? 'CA');
  const [taxId, setTaxId] = useState(firm.taxId ?? '');
  const [taxIdType, setTaxIdType] = useState(firm.taxIdType ?? (country === 'CA' ? 'ca_gst_hst' : 'us_ein'));
  const [busy, setBusy] = useState(false);

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      const address =
        line1 || line2 || city || province || postalCode
          ? {
              line1: line1 || undefined,
              line2: line2 || undefined,
              city: city || undefined,
              province: province || undefined,
              postalCode: postalCode || undefined,
              country,
            }
          : null;
      await rpcMutation(
        'platform.tenant.update',
        {
          id: firm.id,
          legalName,
          displayName,
          contactName,
          contactEmail,
          contactPhone: contactPhone || null,
          address,
          taxId: taxId || null,
          taxIdType: taxId ? taxIdType : null,
        },
        { token },
      );
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Edit ${firm.displayName}`} onClose={onClose}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label htmlFor="ef_legal">Legal name</Label>
          <Input id="ef_legal" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ef_display">Display name</Label>
          <Input id="ef_display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ef_cname">Contact name</Label>
          <Input id="ef_cname" value={contactName} onChange={(e) => setContactName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ef_cemail">Contact email</Label>
          <Input id="ef_cemail" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="ef_cphone">Contact phone</Label>
          <Input id="ef_cphone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--color-border-muted)] pt-4">
        <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Billing address</div>
        <div className="mt-3 space-y-3">
          <Input value={line1} onChange={(e) => setLine1(e.target.value)} placeholder="Street" />
          <Input value={line2} onChange={(e) => setLine2(e.target.value)} placeholder="Suite / unit" />
          <div className="grid grid-cols-3 gap-3">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City" />
            <Input value={province} onChange={(e) => setProvince(e.target.value)} placeholder="Province" />
            <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} placeholder="Postal" />
          </div>
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          >
            <option value="CA">Canada</option>
            <option value="US">United States</option>
          </select>
        </div>
      </div>

      <div className="mt-4 border-t border-[var(--color-border-muted)] pt-4">
        <div className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Tax ID</div>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <select
            value={taxIdType}
            onChange={(e) => setTaxIdType(e.target.value)}
            className="col-span-1 h-10 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
          >
            <option value="ca_gst_hst">GST/HST (CA)</option>
            <option value="ca_qst">QST (QC)</option>
            <option value="ca_pst_bc">PST (BC)</option>
            <option value="us_ein">EIN (US)</option>
            <option value="eu_vat">EU VAT</option>
            <option value="gb_vat">GB VAT</option>
            <option value="in_gst">India GST</option>
          </select>
          <Input
            className="col-span-2 font-mono"
            value={taxId}
            onChange={(e) => setTaxId(e.target.value)}
            placeholder="123456789RT0001"
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy}>
          {busy ? <Spinner /> : null}
          Save changes
        </Button>
      </div>
    </ModalShell>
  );
}

function EditAdminDialog({
  user,
  tenantContactEmail,
  onClose,
  onSaved,
  onError,
}: {
  user: Firm['users'][number];
  tenantContactEmail: string | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  // Default the "also update billing contact" checkbox based on whether
  // the tenant's contactEmail currently matches this user's email.
  const wasContactSync = tenantContactEmail !== null && tenantContactEmail === user.email;
  const [syncContactEmail, setSyncContactEmail] = useState(wasContactSync);
  const [busy, setBusy] = useState(false);
  const emailChanged = email !== user.email;

  async function save(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'platform.user.update',
        {
          userId: user.id,
          name,
          email,
          syncContactEmail: emailChanged && syncContactEmail,
        },
        { token },
      );
      await onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Edit firm administrator" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3 text-xs text-[var(--color-text-muted)]">
          User ID: <code className="font-mono">{user.id}</code>
        </div>

        <div>
          <Label htmlFor="ea_name">Full name</Label>
          <Input id="ea_name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <Label htmlFor="ea_email">Login email</Label>
          <Input
            id="ea_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {emailChanged ? (
            <p className="mt-1.5 text-xs text-[var(--color-warning)]">
              Changing the login email signs the user out of every device. They&apos;ll need to use{' '}
              <span className="font-mono">{email}</span> on next sign-in.
            </p>
          ) : null}
        </div>

        {emailChanged ? (
          <label className="inline-flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={syncContactEmail}
              onChange={(e) => setSyncContactEmail(e.target.checked)}
              className="mt-1"
            />
            <span>
              Also update the firm&apos;s billing contact email
              {wasContactSync
                ? ' (currently matches the old address)'
                : tenantContactEmail
                  ? ` — currently set to ${tenantContactEmail}`
                  : ''}
              .
            </span>
          </label>
        ) : null}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : null}
            Save changes
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

function DeleteFirmDialog({
  firm,
  onClose,
  onDeleted,
  onError,
}: {
  firm: Firm;
  onClose: () => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
}) {
  const [confirmSlug, setConfirmSlug] = useState('');
  const [busy, setBusy] = useState(false);

  async function doDelete(): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'platform.tenant.delete',
        { id: firm.id, confirmSlug, immediate: false },
        { token },
      );
      onDeleted();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Delete ${firm.displayName}?`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
          This soft-deletes the firm: status flips to <span className="font-mono">CANCELED</span>,
          the Stripe subscription cancels at period end, and every active session is revoked.
          Audit history and invoices are kept. Hard delete is intentionally not exposed.
        </div>
        <div>
          <Label htmlFor="cs">
            Type the firm slug{' '}
            <span className="font-mono text-[var(--color-text-muted)]">{firm.slug}</span> to
            confirm
          </Label>
          <Input
            id="cs"
            value={confirmSlug}
            onChange={(e) => setConfirmSlug(e.target.value)}
            className="font-mono"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy || confirmSlug !== firm.slug} onClick={doDelete}>
            {busy ? <Spinner /> : <Trash2 size={14} />}
            Delete firm
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

type AiUsageResp = {
  from: string;
  to: string;
  days: number;
  callCount: number;
  totals: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    costCents: number;
  };
  byFeature: { feature: string; calls: number; costCents: number }[];
  byModel: { model: string; calls: number; costCents: number }[];
};

function AiUsageCard({ tenantId }: { tenantId: string }) {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<AiUsageResp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setErr(null);
    const token = getAccessToken();
    rpcQuery<AiUsageResp>('platform.tenant.aiUsage', { tenantId, days }, { token })
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Failed'));
  }, [tenantId, days]);

  const dollar = (cents: number): string =>
    `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between">
          <CardTitle>AI usage</CardTitle>
          <div className="flex items-center gap-1 rounded-[var(--radius-pill)] border border-[var(--color-border)] p-1 text-xs">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={
                  'rounded-[var(--radius-pill)] px-3 py-1 ' +
                  (days === d
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]')
                }
              >
                {d}d
              </button>
            ))}
          </div>
        </div>
        {err ? (
          <p className="mt-3 text-sm text-[var(--color-danger)]">{err}</p>
        ) : data === null ? (
          <Skeleton className="mt-4 h-32" />
        ) : (
          <>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Tile label="Calls" value={data.callCount.toLocaleString()} />
              <Tile label="Cost" value={dollar(data.totals.costCents)} />
              <Tile
                label="Input tokens"
                value={data.totals.inputTokens.toLocaleString()}
              />
              <Tile
                label="Output tokens"
                value={data.totals.outputTokens.toLocaleString()}
              />
            </div>
            {data.byFeature.length > 0 ? (
              <div className="mt-6">
                <div className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
                  By feature
                </div>
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <tr>
                      <th className="py-1 text-left font-medium">Feature</th>
                      <th className="py-1 text-right font-medium">Calls</th>
                      <th className="py-1 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-muted)]">
                    {data.byFeature.map((r) => (
                      <tr key={r.feature}>
                        <td className="py-2">{r.feature}</td>
                        <td className="py-2 text-right">{r.calls}</td>
                        <td className="py-2 text-right tabular-nums">{dollar(r.costCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-xs text-[var(--color-text-muted)]">
                No AI activity in the last {days} days.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

const KNOWN_FLAGS: { key: string; label: string; detail: string }[] = [
  { key: 'aiAgent', label: 'AI agent', detail: 'Daily missing-document follow-ups via Claude.' },
  { key: 'whiteLabel', label: 'White-label', detail: 'Hide all OnsecBoad branding from firm UI + emails.' },
  { key: 'customDomain', label: 'Custom domain', detail: 'Allow firm to host portal at their own subdomain.' },
  { key: 'betaFeatures', label: 'Beta features', detail: 'Early access to features still under feature flag.' },
];

function PlatformControlsCard({
  tenantId,
  flags,
  announcement,
  onChanged,
  onError,
}: {
  tenantId: string;
  flags: Record<string, boolean>;
  announcement: { message: string; level: 'info' | 'warning' | 'urgent' } | null;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [annMessage, setAnnMessage] = useState(announcement?.message ?? '');
  const [annLevel, setAnnLevel] = useState<'info' | 'warning' | 'urgent'>(
    announcement?.level ?? 'info',
  );

  async function setFlag(key: string, value: boolean): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('platform.tenant.setFeatureFlag', { tenantId, key, value }, { token });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Set failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveAnnouncement(clear: boolean): Promise<void> {
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation(
        'platform.tenant.setAnnouncement',
        {
          tenantId,
          message: clear ? null : annMessage,
          level: annLevel,
        },
        { token },
      );
      onChanged();
      if (clear) setAnnMessage('');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Platform controls</CardTitle>
        <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
          Onsective-only controls. Toggle features, post a banner the firm sees on every page.
        </CardBody>

        <div className="mt-4">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Feature flags
          </div>
          <div className="mt-2 divide-y divide-[var(--color-border-muted)]">
            {KNOWN_FLAGS.map((f) => (
              <label
                key={f.key}
                className="flex cursor-pointer items-start justify-between gap-3 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{f.label}</div>
                  <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{f.detail}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-[var(--color-text-muted)]">
                    {f.key}
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 cursor-pointer accent-[var(--color-primary)]"
                  disabled={busy}
                  checked={!!flags[f.key]}
                  onChange={(e) => void setFlag(f.key, e.target.checked)}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--color-text-muted)]">
            Firm-wide announcement
          </div>
          <CardBody className="mt-1 text-xs text-[var(--color-text-muted)]">
            Banner shown above the firm&rsquo;s top bar. Use sparingly.
          </CardBody>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Label className="mb-1 block text-xs">Message</Label>
              <Input
                value={annMessage}
                onChange={(e) => setAnnMessage(e.target.value)}
                placeholder="Scheduled maintenance Sunday 2-4am ET — service may be slow."
                maxLength={500}
              />
            </div>
            <div>
              <Label className="mb-1 block text-xs">Level</Label>
              <select
                value={annLevel}
                onChange={(e) => setAnnLevel(e.target.value as 'info' | 'warning' | 'urgent')}
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
              >
                <option value="info">Info (blue)</option>
                <option value="warning">Warning (amber)</option>
                <option value="urgent">Urgent (red)</option>
              </select>
            </div>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            {announcement ? (
              <Button variant="ghost" disabled={busy} onClick={() => void saveAnnouncement(true)}>
                Clear banner
              </Button>
            ) : null}
            <Button disabled={busy || annMessage.trim().length === 0} onClick={() => void saveAnnouncement(false)}>
              {announcement ? 'Update' : 'Post'} announcement
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

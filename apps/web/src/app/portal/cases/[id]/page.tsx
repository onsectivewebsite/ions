'use client';
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, CheckCircle2, ClipboardCheck } from 'lucide-react';
import {
  Badge,
  Card,
  CardTitle,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcQuery } from '../../../../lib/api';
import { getPortalToken } from '../../../../lib/portal-session';
import { PortalShell } from '../../../../components/portal/PortalShell';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string; email: string | null };
  tenant: { displayName: string; branding: Branding };
};

type CaseDetail = {
  id: string;
  caseType: string;
  status: string;
  retainerFeeCents: number | null;
  totalFeeCents: number | null;
  amountPaidCents: number;
  feesCleared: boolean;
  irccFileNumber: string | null;
  irccDecision: string | null;
  irccPortalDate: string | null;
  retainerApprovedAt: string | null;
  retainerSignedAt: string | null;
  documentsLockedAt: string | null;
  lawyerApprovedAt: string | null;
  submittedToIrccAt: string | null;
  completedAt: string | null;
  appointments: Array<{
    id: string;
    scheduledAt: string;
    durationMin: number;
    kind: string;
    caseType: string | null;
    status: string;
    outcome: string | null;
    provider: { name: string };
  }>;
  intake: Array<{ id: string; caseType: string; submittedAt: string; template: { name: string } }>;
  irccLog: Array<{ id: string; type: string; occurredAt: string }>;
};

const STATUS_TONE: Record<string, 'success' | 'warning' | 'neutral' | 'danger'> = {
  PENDING_RETAINER: 'warning',
  PENDING_RETAINER_SIGNATURE: 'warning',
  PENDING_DOCUMENTS: 'warning',
  PREPARING: 'neutral',
  PENDING_LAWYER_APPROVAL: 'warning',
  SUBMITTED_TO_IRCC: 'success',
  IN_REVIEW: 'success',
  COMPLETED: 'success',
  WITHDRAWN: 'danger',
  ABANDONED: 'danger',
};

const IRCC_LABELS: Record<string, string> = {
  submission: 'Submitted to IRCC',
  decision: 'Decision received',
  biometrics_requested: 'Biometrics requested',
  biometrics_completed: 'Biometrics completed',
  interview_scheduled: 'Interview scheduled',
  interview_completed: 'Interview completed',
  medical_requested: 'Medical exam requested',
  medical_completed: 'Medical exam completed',
};

function fmtMoney(cents: number | null): string {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export default function PortalCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [c, setCase] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    Promise.all([
      rpcQuery<Me>('portal.me', undefined, { token }),
      rpcQuery<CaseDetail>('portal.caseDetail', { id }, { token }),
    ])
      .then(([m, k]) => {
        setMe(m);
        setCase(k);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load');
      });
  }, [router, id]);

  if (!me || !c) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        {error ? (
          <Card>
            <CardTitle>File unavailable</CardTitle>
            <p className="mt-2 text-sm text-[var(--color-text-muted)]">{error}</p>
          </Card>
        ) : (
          <>
            <Skeleton className="h-12" />
            <Skeleton className="h-64" />
          </>
        )}
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const fullName =
    [me.client.firstName, me.client.lastName].filter(Boolean).join(' ') || me.email;

  const lifecycle: Array<{ label: string; at: string | null }> = [
    { label: 'Retainer approved', at: c.retainerApprovedAt },
    { label: 'Retainer signed', at: c.retainerSignedAt },
    { label: 'Documents submitted', at: c.documentsLockedAt },
    { label: 'Lawyer approved file', at: c.lawyerApprovedAt },
    { label: 'Submitted to IRCC', at: c.submittedToIrccAt },
    { label: 'Decision received', at: c.completedAt },
  ];
  const target = c.totalFeeCents ?? c.retainerFeeCents;
  const owed = target != null ? Math.max(0, target - c.amountPaidCents) : null;

  return (
    <ThemeProvider branding={branding}>
      <PortalShell firmName={me.tenant.displayName} clientName={fullName}>
        <div className="space-y-6">
          <Link
            href="/portal/dashboard"
            className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            <ArrowLeft size={12} />
            Back to my files
          </Link>

          <div>
            <div className="text-xs text-[var(--color-text-muted)]">{c.caseType.replace('_', ' ')}</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your file</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status.replaceAll('_', ' ')}</Badge>
              {c.feesCleared ? <Badge tone="success">Fees cleared</Badge> : <Badge tone="warning">Fees outstanding</Badge>}
              {c.irccDecision ? <Badge tone="success">Decision: {c.irccDecision}</Badge> : null}
            </div>
          </div>

          <Card>
            <CardTitle>Progress</CardTitle>
            <ul className="mt-3 space-y-2 text-sm">
              {lifecycle.map((s) => (
                <li key={s.label} className="flex items-center gap-3">
                  <CheckCircle2
                    size={14}
                    className={s.at ? 'text-[var(--color-success)]' : 'text-[var(--color-border)]'}
                  />
                  <span className={s.at ? '' : 'text-[var(--color-text-muted)]'}>{s.label}</span>
                  <span className="ml-auto text-xs text-[var(--color-text-muted)]">{fmtDate(s.at)}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardTitle>Fees</CardTitle>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Row label="Retainer">{fmtMoney(c.retainerFeeCents)}</Row>
              <Row label="Total fee">{fmtMoney(c.totalFeeCents)}</Row>
              <Row label="Paid">{fmtMoney(c.amountPaidCents)}</Row>
              <Row label="Outstanding">{owed != null ? fmtMoney(owed) : '—'}</Row>
            </dl>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Files are not submitted to IRCC until all fees are cleared. Contact your firm if you
              need to discuss payment.
            </p>
          </Card>

          {c.irccFileNumber || c.irccPortalDate ? (
            <Card>
              <CardTitle>IRCC reference</CardTitle>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                {c.irccFileNumber ? <Row label="IRCC file #">{c.irccFileNumber}</Row> : null}
                {c.irccPortalDate ? <Row label="Submitted">{fmtDate(c.irccPortalDate)}</Row> : null}
              </dl>
            </Card>
          ) : null}

          {c.appointments.length > 0 ? (
            <Card>
              <CardTitle>Appointments</CardTitle>
              <ul className="mt-3 divide-y divide-[var(--color-border-muted)]">
                {c.appointments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-medium">{new Date(a.scheduledAt).toLocaleString()}</div>
                      <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                        {a.kind} · {a.provider.name} · {a.durationMin} min
                      </div>
                    </div>
                    <Badge tone={a.status === 'COMPLETED' ? 'success' : 'neutral'}>{a.status}</Badge>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {c.irccLog.length > 0 ? (
            <Card>
              <CardTitle>IRCC milestones</CardTitle>
              <ul className="mt-3 space-y-2 text-sm">
                {c.irccLog.map((e) => (
                  <li key={e.id} className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2">
                      <Calendar size={12} className="text-[var(--color-text-muted)]" />
                      {IRCC_LABELS[e.type] ?? e.type.replaceAll('_', ' ')}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {new Date(e.occurredAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {c.intake.length > 0 ? (
            <Card>
              <CardTitle>Intake on file</CardTitle>
              <ul className="mt-3 space-y-2 text-sm">
                {c.intake.map((i) => (
                  <li key={i.id} className="flex items-center justify-between">
                    <span className="inline-flex items-center gap-2">
                      <ClipboardCheck size={12} className="text-[var(--color-text-muted)]" />
                      {i.template.name}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {new Date(i.submittedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </PortalShell>
    </ThemeProvider>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

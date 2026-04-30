'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Briefcase } from 'lucide-react';
import { Button, Card, Input, Skeleton, ThemeProvider, type Branding } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';
import { NotFoundPanel } from '../../../components/NotFoundPanel';

type Client = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  language: string | null;
  notes: string | null;
  branchId: string | null;
  createdAt: string;
  updatedAt: string;
};

type IntakeRow = {
  id: string;
  submittedAt: string;
  template: { id: string; name: string; caseType: string } | null;
};

type Resp = { client: Client; intake: IntakeRow[] };

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [resp, setResp] = useState<Resp | null>(null);
  const [edits, setEdits] = useState<Partial<Client>>({});
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [notFound, setNotFound] = useState(false);

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
    rpcQuery<Resp>('client.get', { id: params.id }, { token })
      .then((r) => {
        setResp(r);
        setEdits({});
        setNotFound(false);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : '';
        if (/not.?found/i.test(msg)) setNotFound(true);
        else router.replace('/clients');
      });
  }, [me, params.id, router]);

  async function save(): Promise<void> {
    if (!resp || Object.keys(edits).length === 0) return;
    const token = getAccessToken();
    if (!token) return;
    setSaving(true);
    try {
      await rpcMutation('client.update', { id: resp.client.id, ...edits }, { token });
      setSavedAt(new Date());
      const fresh = await rpcQuery<Resp>('client.get', { id: resp.client.id }, { token });
      setResp(fresh);
      setEdits({});
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (notFound && me) {
    const branding = me.tenant?.branding ?? { themeCode: 'maple' as const };
    const shellUser: ShellUser = {
      name: me.name,
      email: me.email,
      scope: 'firm',
      contextLabel: me.tenant.displayName,
    };
    return (
      <ThemeProvider branding={branding}>
        <AppShell user={shellUser}>
          <NotFoundPanel
            title="Client not found"
            message="This client doesn't exist anymore — it may have been deleted, or the link is wrong."
            backHref="/clients"
            backLabel="Back to clients"
          />
        </AppShell>
      </ThemeProvider>
    );
  }
  if (!me || !resp) {
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

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: 'firm',
    contextLabel: me.tenant.displayName,
  };
  const c = resp.client;
  const fullName = [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Unnamed client';
  const dirty = Object.keys(edits).length > 0;

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-6">
          <div>
            <Link
              href="/clients"
              className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <ArrowLeft size={12} />
              All clients
            </Link>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">{fullName}</h1>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              Created {new Date(c.createdAt).toLocaleDateString()} · last updated{' '}
              {new Date(c.updatedAt).toLocaleString()}
            </p>
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-medium">Contact details</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs">
                <div className="mb-1 text-[var(--color-text-muted)]">First name</div>
                <Input
                  value={edits.firstName ?? c.firstName ?? ''}
                  onChange={(e) => setEdits({ ...edits, firstName: e.target.value })}
                />
              </label>
              <label className="text-xs">
                <div className="mb-1 text-[var(--color-text-muted)]">Last name</div>
                <Input
                  value={edits.lastName ?? c.lastName ?? ''}
                  onChange={(e) => setEdits({ ...edits, lastName: e.target.value })}
                />
              </label>
              <label className="text-xs">
                <div className="mb-1 text-[var(--color-text-muted)]">Phone</div>
                <Input
                  value={edits.phone ?? c.phone ?? ''}
                  onChange={(e) => setEdits({ ...edits, phone: e.target.value })}
                />
              </label>
              <label className="text-xs">
                <div className="mb-1 text-[var(--color-text-muted)]">Email</div>
                <Input
                  type="email"
                  value={edits.email ?? c.email ?? ''}
                  onChange={(e) => setEdits({ ...edits, email: e.target.value || null })}
                />
              </label>
              <label className="text-xs">
                <div className="mb-1 text-[var(--color-text-muted)]">Language</div>
                <Input
                  value={edits.language ?? c.language ?? ''}
                  onChange={(e) => setEdits({ ...edits, language: e.target.value || null })}
                  placeholder="en, fr, hi…"
                />
              </label>
            </div>
            <label className="mt-3 block text-xs">
              <div className="mb-1 text-[var(--color-text-muted)]">Internal notes</div>
              <textarea
                value={edits.notes ?? c.notes ?? ''}
                onChange={(e) => setEdits({ ...edits, notes: e.target.value || null })}
                rows={3}
                className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              />
            </label>
            <div className="mt-3 flex items-center justify-end gap-2">
              {savedAt ? (
                <span className="text-xs text-[var(--color-text-muted)]">
                  Saved {savedAt.toLocaleTimeString()}
                </span>
              ) : null}
              <Button onClick={save} disabled={!dirty || saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium">Intake history</h2>
            </div>
            {resp.intake.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
                No intake submissions for this client yet.
              </div>
            ) : (
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Template</th>
                    <th className="py-2 pr-4">Case type</th>
                    <th className="py-2 pr-4">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {resp.intake.map((s) => (
                    <tr key={s.id} className="border-b border-[var(--color-border-muted)]">
                      <td className="py-3 pr-4">{s.template?.name ?? '—'}</td>
                      <td className="py-3 pr-4 text-[var(--color-text-muted)]">
                        {s.template?.caseType ?? '—'}
                      </td>
                      <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                        {new Date(s.submittedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-medium">Open a case for this client</h2>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  Cases track ongoing immigration matters — IRCC submissions, milestones, invoices.
                </p>
              </div>
              <Link href={`/cases/new?clientId=${c.id}`}>
                <Button>
                  <Briefcase size={14} />
                  New case
                </Button>
              </Link>
            </div>
          </Card>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

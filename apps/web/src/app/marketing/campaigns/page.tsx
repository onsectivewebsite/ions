'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Megaphone, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Campaign = {
  id: string;
  name: string;
  channel: 'sms' | 'email' | 'meta' | 'tiktok' | 'manual';
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed';
  startsAt: string | null;
  endsAt: string | null;
  branchId: string | null;
  createdAt: string;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const CHANNELS: Campaign['channel'][] = ['sms', 'email', 'meta', 'tiktok', 'manual'];

export default function CampaignsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Campaign[] | null>(null);
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const [list, m] = await Promise.all([
        rpcQuery<Campaign[]>('campaign.list', undefined, { token }),
        rpcQuery<Me>('user.me', undefined, { token }),
      ]);
      setItems(list);
      if (m.kind !== 'firm') {
        router.replace('/dashboard');
        return;
      }
      setMe(m);
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
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function remove(id: string): Promise<void> {
    if (!confirm('Delete this campaign?')) return;
    try {
      const token = getAccessToken();
      await rpcMutation('campaign.delete', { id }, { token });
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  if (!me || items === null) {
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
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div className="flex items-end justify-between">
            <div>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <ArrowLeft size={12} />
                Back to dashboard
              </Link>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Campaigns</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Marketing + outreach campaigns. Phase 3.4 lets you record campaign metadata; the
                ability to run broadcast SMS/email blasts ships in Phase 4.
              </p>
            </div>
            <Button onClick={() => setEditing('new')}>
              <Plus size={14} /> New campaign
            </Button>
          </div>

          {error ? (
            <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
              {error}
            </div>
          ) : null}

          <Card>
            {items.length === 0 ? (
              <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">
                <Megaphone size={28} className="mx-auto mb-2 opacity-40" />
                No campaigns yet.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  <tr>
                    <th className="py-2 text-left font-medium">Name</th>
                    <th className="py-2 text-left font-medium">Channel</th>
                    <th className="py-2 text-left font-medium">Status</th>
                    <th className="py-2 text-left font-medium">Window</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border-muted)]">
                  {items.map((c) => (
                    <tr key={c.id}>
                      <td className="py-3 font-medium">{c.name}</td>
                      <td className="py-3">
                        <Badge tone="neutral">{c.channel}</Badge>
                      </td>
                      <td className="py-3">
                        <Badge
                          tone={
                            c.status === 'running'
                              ? 'success'
                              : c.status === 'completed'
                                ? 'neutral'
                                : c.status === 'paused'
                                  ? 'warning'
                                  : 'neutral'
                          }
                        >
                          {c.status}
                        </Badge>
                      </td>
                      <td className="py-3 text-xs text-[var(--color-text-muted)]">
                        {fmt(c.startsAt)} → {fmt(c.endsAt)}
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => setEditing(c)}
                          className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                          aria-label="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => void remove(c.id)}
                          className="ml-2 rounded-[var(--radius-md)] border border-[var(--color-border)] p-1.5 text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
                          aria-label="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        {editing ? (
          <CampaignEditor
            initial={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void load();
            }}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

function fmt(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function CampaignEditor({
  initial,
  onClose,
  onSaved,
}: {
  initial: Campaign | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [channel, setChannel] = useState<Campaign['channel']>(initial?.channel ?? 'sms');
  const [status, setStatus] = useState<Campaign['status']>(initial?.status ?? 'draft');
  const [startsAt, setStartsAt] = useState(initial?.startsAt?.slice(0, 10) ?? '');
  const [endsAt, setEndsAt] = useState(initial?.endsAt?.slice(0, 10) ?? '');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const token = getAccessToken();
      const payload = {
        name,
        channel,
        body: body || undefined,
        startsAt: startsAt ? new Date(startsAt).toISOString() : undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
      };
      if (initial) {
        await rpcMutation(
          'campaign.update',
          { id: initial.id, ...payload, status },
          { token },
        );
      } else {
        await rpcMutation('campaign.create', payload, { token });
      }
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{initial ? 'Edit campaign' : 'New campaign'}</h2>
          <button
            onClick={onClose}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Close
          </button>
        </div>
        {err ? (
          <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-2 text-xs text-[var(--color-danger)]">
            {err}
          </div>
        ) : null}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Channel</Label>
              <select
                className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                value={channel}
                onChange={(e) => setChannel(e.target.value as Campaign['channel'])}
              >
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {initial ? (
              <div>
                <Label>Status</Label>
                <select
                  className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as Campaign['status'])}
                >
                  {(['draft', 'scheduled', 'running', 'paused', 'completed'] as const).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Starts</Label>
              <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </div>
            <div>
              <Label>Ends</Label>
              <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Message body (optional)</Label>
            <textarea
              className="min-h-[80px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-sm"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Hello {{firstName}}, …"
            />
          </div>
          <div className="flex items-center justify-end gap-2 pt-3">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

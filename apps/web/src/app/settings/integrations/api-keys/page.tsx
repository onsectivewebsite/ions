'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  KeyRound,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../../lib/api';
import { getAccessToken } from '../../../../lib/session';
import { AppShell, type ShellUser } from '../../../../components/AppShell';

type ApiKey = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
};

type Me = {
  kind: 'firm';
  name: string;
  email: string;
  tenant: { displayName: string; branding: Branding };
};

const SCOPE_LABELS: Record<string, string> = {
  'leads:write': 'Create leads',
  'leads:read': 'Read leads',
};

export default function ApiKeysPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<ApiKey[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ name: string; plaintext: string } | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    const token = getAccessToken();
    if (!token) return;
    try {
      const r = await rpcQuery<ApiKey[]>('apiKey.list', undefined, { token });
      setItems(r);
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
        if (m.kind !== 'firm') {
          router.replace('/dashboard');
          return;
        }
        setMe(m);
      })
      .catch(() => router.replace('/sign-in'));
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function revoke(k: ApiKey): Promise<void> {
    if (!confirm(`Revoke ${k.name}? Any service using this key will start getting 401s immediately.`)) {
      return;
    }
    setError(null);
    try {
      const token = getAccessToken();
      await rpcMutation('apiKey.revoke', { id: k.id }, { token });
      setInfo(`Revoked ${k.name}.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed');
    }
  }

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
          <div className="flex items-end justify-between gap-4">
            <div>
              <Link
                href="/settings"
                className="inline-flex items-center gap-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
              >
                <ArrowLeft size={12} />
                Back to settings
              </Link>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">API keys</h1>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                Bearer tokens your website forms, Zapier flows, or other integrations use to
                post leads to OnsecBoad. Keep them secret — anyone with the key can create leads
                in your firm.
              </p>
            </div>
            <Button onClick={() => setCreating(true)}>
              <Plus size={14} />
              New key
            </Button>
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

          <Card>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Prefix</th>
                    <th className="py-2 pr-4">Scopes</th>
                    <th className="py-2 pr-4">Last used</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4"></th>
                  </tr>
                </thead>
                <tbody>
                  {items === null ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-muted)]">
                        <td colSpan={6} className="py-3">
                          <Skeleton className="h-6" />
                        </td>
                      </tr>
                    ))
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                          <KeyRound size={20} />
                        </div>
                        <div className="text-sm font-medium">No API keys yet</div>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          Click <span className="font-medium">New key</span> to issue one.
                        </p>
                      </td>
                    </tr>
                  ) : (
                    items.map((k) => (
                      <tr key={k.id} className="border-b border-[var(--color-border-muted)]">
                        <td className="py-3 pr-4 font-medium">{k.name}</td>
                        <td className="py-3 pr-4">
                          <code className="font-mono text-xs">{k.keyPrefix}…</code>
                        </td>
                        <td className="py-3 pr-4">
                          <div className="flex flex-wrap gap-1">
                            {k.scopes.map((s) => (
                              <Badge key={s} tone="neutral">
                                {SCOPE_LABELS[s] ?? s}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-xs text-[var(--color-text-muted)]">
                          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
                        </td>
                        <td className="py-3 pr-4">
                          {k.revokedAt ? (
                            <Badge tone="danger">Revoked</Badge>
                          ) : (
                            <Badge tone="success">Active</Badge>
                          )}
                        </td>
                        <td className="py-3 pr-4 text-right">
                          {!k.revokedAt ? (
                            <Button size="sm" variant="ghost" onClick={() => revoke(k)}>
                              <Trash2 size={12} /> Revoke
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardTitle>Quick start — POST a lead</CardTitle>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Once you&apos;ve created a key, your website / Zapier / lead-gen tool can post leads to
              your firm. Replace <code>YOUR_KEY</code> with the key below (revealed once on creation).
            </p>
            <pre className="mt-3 overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-3 text-xs">
{`curl -X POST https://api.onsective.cloud/api/v1/leads/ingest \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "firstName": "John",
    "lastName":  "Doe",
    "phone":     "+14165551212",
    "email":     "john@example.com",
    "source":    "website",
    "language":  "en",
    "caseInterest": "work_permit",
    "consentMarketing": true
  }'`}
            </pre>
            <p className="mt-3 text-xs text-[var(--color-text-muted)]">
              Returns <code>201 {'{'} id, assignedToId {'}'}</code> on success. Lead is auto-distributed
              round-robin to an active TELECALLER in the target branch. Specify <code>{'"branchId"'}</code> in
              the body to scope to a specific branch — otherwise firm-wide pool.
            </p>
          </Card>
        </div>

        {creating ? (
          <CreateKeyDialog
            onClose={() => setCreating(false)}
            onCreated={async (key) => {
              setCreating(false);
              setRevealedKey({ name: key.name, plaintext: key.plaintextKey });
              await refresh();
            }}
            onError={(msg) => setError(msg)}
          />
        ) : null}

        {revealedKey ? (
          <RevealedKeyDialog
            keyName={revealedKey.name}
            plaintext={revealedKey.plaintext}
            onClose={() => setRevealedKey(null)}
          />
        ) : null}
      </AppShell>
    </ThemeProvider>
  );
}

function CreateKeyDialog({
  onClose,
  onCreated,
  onError,
}: {
  onClose: () => void;
  onCreated: (key: { name: string; plaintextKey: string }) => void | Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['leads:write']);
  const [busy, setBusy] = useState(false);

  function toggleScope(s: string): void {
    setScopes((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!name || scopes.length === 0) return;
    setBusy(true);
    try {
      const token = getAccessToken();
      const created = await rpcMutation<{ id: string; name: string; plaintextKey: string }>(
        'apiKey.create',
        { name, scopes },
        { token },
      );
      await onCreated(created);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-md">
        <div className="flex items-center justify-between border-b border-[var(--color-border-muted)] pb-3">
          <CardTitle>New API key</CardTitle>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--radius-md)] p-1 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <Label htmlFor="kn">Name *</Label>
            <Input
              id="kn"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="website-form"
              autoFocus
              required
            />
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              For your reference only — pick something descriptive.
            </p>
          </div>
          <div>
            <Label>Scopes *</Label>
            <div className="mt-2 space-y-2">
              <label className="inline-flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scopes.includes('leads:write')}
                  onChange={() => toggleScope('leads:write')}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">leads:write</span> — create new leads via REST
                </span>
              </label>
            </div>
            <p className="mt-2 text-xs text-[var(--color-text-muted)]">
              Read scopes ship with future phases.
            </p>
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-muted)] pt-4">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name || scopes.length === 0}>
              {busy ? <Spinner /> : <KeyRound size={14} />}
              Create key
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

function RevealedKeyDialog({
  keyName,
  plaintext,
  onClose,
}: {
  keyName: string;
  plaintext: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    await navigator.clipboard.writeText(plaintext);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-12">
      <Card className="w-full max-w-lg">
        <div className="flex items-center gap-3 border-b border-[var(--color-border-muted)] pb-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-pill)] bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] text-[var(--color-warning)]">
            <AlertTriangle size={18} />
          </div>
          <div>
            <CardTitle>Save your key now</CardTitle>
            <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              This is the only time you&apos;ll see <span className="font-medium">{keyName}</span> in
              full. Once you close this dialog, you can&apos;t retrieve it again.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          <div>
            <Label>API key</Label>
            <div className="mt-1 flex items-center gap-2">
              <code className="flex-1 break-all rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3 font-mono text-xs">
                {plaintext}
              </code>
              <Button onClick={copy} variant="secondary" size="sm">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">
            Treat this like a password — anyone with it can post leads as your firm. If it leaks,
            revoke it immediately and issue a new one.
          </p>
          <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-muted)] pt-4">
            <Button onClick={onClose}>I&apos;ve saved it</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

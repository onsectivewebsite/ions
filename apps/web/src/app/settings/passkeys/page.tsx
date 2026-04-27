'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { startRegistration, browserSupportsWebAuthn } from '@simplewebauthn/browser';
import { KeyRound, Plus, Trash2, ShieldCheck } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardTitle,
  Skeleton,
  Spinner,
  ThemeProvider,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getAccessToken } from '../../../lib/session';
import { AppShell, type ShellUser } from '../../../components/AppShell';

type Passkey = {
  id: string;
  deviceType: string;
  transports: string[];
  createdAt: string;
  lastUsedAt: string | null;
};

type Me =
  | {
      kind: 'platform';
      name: string;
      email: string;
    }
  | {
      kind: 'firm';
      name: string;
      email: string;
      tenant: { displayName: string; branding: Branding };
    };

export default function PasskeysPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Passkey[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const token = getAccessToken();
    if (!token) return;
    const list = await rpcQuery<Passkey[]>('user.passkeyList', undefined, { token });
    setItems(list);
  }, []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace('/sign-in');
      return;
    }
    rpcQuery<Me>('user.me', undefined, { token })
      .then(setMe)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed'));
    void refresh();
  }, [router, refresh]);

  async function addPasskey(): Promise<void> {
    setError(null);
    setInfo(null);
    if (!browserSupportsWebAuthn()) {
      setError('This browser does not support passkeys.');
      return;
    }
    setBusy(true);
    try {
      const token = getAccessToken();
      const { challengeId, options } = await rpcMutation<{
        challengeId: string;
        options: Parameters<typeof startRegistration>[0];
      }>('auth.passkeyBeginRegistration', undefined, { token });
      const att = await startRegistration(options);
      await rpcMutation('auth.passkeyFinishRegistration', { challengeId, response: att }, { token });
      setInfo('Passkey added. You can now sign in with it.');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    if (!confirm('Remove this passkey? You can add another any time.')) return;
    const token = getAccessToken();
    await rpcMutation('user.passkeyDelete', { id }, { token });
    await refresh();
  }

  if (!me) {
    return (
      <main className="grid min-h-screen grid-cols-[240px_1fr]">
        <div className="border-r border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="space-y-4 p-8">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      </main>
    );
  }

  const branding: Branding =
    me.kind === 'firm' ? me.tenant.branding ?? { themeCode: 'maple' } : { themeCode: 'maple' };

  const shellUser: ShellUser = {
    name: me.name,
    email: me.email,
    scope: me.kind,
    contextLabel: me.kind === 'firm' ? me.tenant.displayName : 'Onsective Platform',
  };

  return (
    <ThemeProvider branding={branding}>
      <AppShell user={shellUser}>
        <div className="space-y-8">
          <div>
            <div className="text-xs text-[var(--color-text-muted)]">Settings</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Passkeys</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Sign in with your fingerprint, face, or device PIN — no password to phish, no
              code to type.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
            <Card>
              <div className="flex items-center justify-between">
                <CardTitle>Your passkeys</CardTitle>
                <Button onClick={addPasskey} disabled={busy} size="sm">
                  {busy ? <Spinner /> : <Plus size={14} />}
                  Add a passkey
                </Button>
              </div>

              {info ? (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-success)]/30 bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] p-3 text-sm text-[var(--color-success)]">
                  {info}
                </div>
              ) : null}
              {error ? (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-danger)]/30 bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)] p-3 text-sm text-[var(--color-danger)]">
                  {error}
                </div>
              ) : null}

              <div className="mt-4 divide-y divide-[var(--color-border-muted)]">
                {items === null ? (
                  <div className="space-y-2 py-2">
                    <Skeleton className="h-12" />
                    <Skeleton className="h-12" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-[var(--radius-pill)] bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]">
                      <KeyRound size={20} />
                    </div>
                    <div className="text-sm font-medium">No passkeys yet</div>
                    <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                      Add one to skip the password on your next sign-in.
                    </p>
                  </div>
                ) : (
                  items.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_srgb,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]">
                          <KeyRound size={16} />
                        </div>
                        <div>
                          <div className="text-sm font-medium capitalize">
                            {p.deviceType.replaceAll('_', ' ')}
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            Added {new Date(p.createdAt).toLocaleDateString()}
                            {p.lastUsedAt
                              ? ` · Last used ${new Date(p.lastUsedAt).toLocaleDateString()}`
                              : ' · Never used'}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {p.transports.length ? (
                          <Badge tone="neutral">{p.transports.join(', ')}</Badge>
                        ) : null}
                        <button
                          onClick={() => remove(p.id)}
                          className="inline-flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1 text-xs text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_8%,transparent)]"
                        >
                          <Trash2 size={12} />
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between">
                <CardTitle>Why passkeys?</CardTitle>
                <ShieldCheck size={16} className="text-[var(--color-text-muted)]" />
              </div>
              <CardBody className="mt-3 space-y-3 text-sm text-[var(--color-text-muted)]">
                <p>
                  Passkeys are phishing-resistant and use the security hardware on your
                  device. Even on a compromised network, a passkey cannot be replayed.
                </p>
                <p>
                  Two-factor verification still applies — passkeys replace the password
                  step, not the second factor.
                </p>
              </CardBody>
            </Card>
          </div>
        </div>
      </AppShell>
    </ThemeProvider>
  );
}

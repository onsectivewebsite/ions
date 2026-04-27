'use client';
import { useEffect, useState } from 'react';
import { Copy, Mail, ShieldCheck, UserX } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Input,
  Label,
  Spinner,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';

type PortalAccount = {
  id: string;
  email: string;
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  invitedAt: string | null;
  joinedAt: string | null;
  lastLoginAt: string | null;
  client: { firstName: string | null; lastName: string | null; phone: string };
};

const STATUS_TONE: Record<PortalAccount['status'], 'success' | 'warning' | 'neutral' | 'danger'> = {
  INVITED: 'warning',
  ACTIVE: 'success',
  DISABLED: 'danger',
};

/**
 * "Client portal access" card on the case detail page. Shows current
 * account state for the case's client + invite/re-invite/disable actions.
 * The setup link (plaintext token) is shown ONCE on successful invite.
 */
export function PortalAccessCard({
  clientId,
  clientEmail,
  onError,
}: {
  clientId: string;
  clientEmail: string | null;
  onError: (m: string) => void;
}) {
  const [items, setItems] = useState<PortalAccount[] | null>(null);
  const [emailOverride, setEmailOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkOnce, setLinkOnce] = useState<string | null>(null);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<PortalAccount[]>(
        'clientPortal.list',
        { clientId },
        { token },
      );
      setItems(r);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load portal access');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function invite(): Promise<void> {
    setBusy(true);
    setLinkOnce(null);
    try {
      const token = getAccessToken();
      const email = emailOverride.trim() || undefined;
      const r = await rpcMutation<{ publicUrl: string }>(
        'clientPortal.invite',
        { clientId, email },
        { token },
      );
      setLinkOnce(r.publicUrl);
      setEmailOverride('');
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Invite failed');
    } finally {
      setBusy(false);
    }
  }

  async function disable(accountId: string): Promise<void> {
    if (!confirm('Disable this client\'s portal access? They will be signed out and unable to log in.'))
      return;
    setBusy(true);
    try {
      const token = getAccessToken();
      await rpcMutation('clientPortal.disable', { accountId }, { token });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Disable failed');
    } finally {
      setBusy(false);
    }
  }

  const account = items?.[0] ?? null;

  return (
    <Card>
      <CardTitle>Client portal access</CardTitle>
      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
        <ShieldCheck size={12} className="mr-1 inline-block" />
        Lets the client sign into their own portal to track this file.
      </p>

      {account ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge tone={STATUS_TONE[account.status]}>{account.status}</Badge>
            <span className="text-sm font-medium">{account.email}</span>
          </div>
          <div className="text-xs text-[var(--color-text-muted)]">
            {account.lastLoginAt
              ? `Last sign-in: ${new Date(account.lastLoginAt).toLocaleString()}`
              : account.joinedAt
                ? 'Account active; never signed in.'
                : `Invited ${account.invitedAt ? new Date(account.invitedAt).toLocaleDateString() : ''}`}
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={invite}>
              <Mail size={12} /> {account.status === 'INVITED' ? 'Resend invite' : 'Send fresh invite'}
            </Button>
            {account.status !== 'DISABLED' ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => disable(account.id)}>
                <UserX size={12} /> Disable
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            No portal account yet. Invite the client to set their password.
          </p>
          <div>
            <Label>Email (defaults to client email)</Label>
            <Input
              type="email"
              value={emailOverride}
              onChange={(e) => setEmailOverride(e.target.value)}
              placeholder={clientEmail ?? 'client@example.com'}
            />
          </div>
          <Button
            size="sm"
            disabled={busy || (!clientEmail && !emailOverride.trim())}
            onClick={invite}
          >
            {busy ? <Spinner /> : <Mail size={12} />} Send invite
          </Button>
        </div>
      )}

      {linkOnce ? (
        <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-2 text-xs">
          <div className="text-[var(--color-text-muted)]">Setup link (shown once):</div>
          <div className="mt-1 flex items-center gap-2">
            <code className="break-all font-mono">{linkOnce}</code>
            <button
              onClick={() => navigator.clipboard.writeText(linkOnce)}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-1 hover:bg-[var(--color-surface)]"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

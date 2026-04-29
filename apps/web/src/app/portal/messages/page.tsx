'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Send } from 'lucide-react';
import {
  Card,
  CardTitle,
  Skeleton,
  Spinner,
  ThemeProvider,
  Button,
  type Branding,
} from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../../lib/api';
import { getPortalToken } from '../../../lib/portal-session';
import { PortalShell } from '../../../components/portal/PortalShell';

type Me = {
  email: string;
  client: { firstName: string | null; lastName: string | null; phone: string; email: string | null };
  tenant: { displayName: string; branding: Branding };
};

type Sender = 'CLIENT' | 'STAFF' | 'SYSTEM';

type Message = {
  id: string;
  sender: Sender;
  body: string;
  createdAt: string;
  caseId: string | null;
  readByClient: string | null;
  readByStaff: string | null;
};

export default function PortalMessagesPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [items, setItems] = useState<Message[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  async function load(): Promise<void> {
    const token = getPortalToken();
    if (!token) {
      router.replace('/portal/sign-in');
      return;
    }
    try {
      const [m, msgs] = await Promise.all([
        rpcQuery<Me>('portal.me', undefined, { token }),
        rpcQuery<Message[]>('portal.messagesList', undefined, { token }),
      ]);
      setMe(m);
      setItems(msgs);
      // Mark every unread STAFF message as seen as soon as the page is open.
      await rpcMutation('portal.messagesMarkRead', undefined, { token });
    } catch {
      router.replace('/portal/sign-in');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mark unread again on tab focus — covers the "left tab open, firm
  // sent a message" case.
  useEffect(() => {
    function onFocus(): void {
      const token = getPortalToken();
      if (!token) return;
      void rpcMutation('portal.messagesMarkRead', undefined, { token }).then(() => {
        void load();
      });
    }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  async function send(e: FormEvent): Promise<void> {
    e.preventDefault();
    const trimmed = body.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const token = getPortalToken();
      await rpcMutation('portal.messagesSend', { body: trimmed }, { token });
      setBody('');
      await load();
    } catch {
      /* surfaced inline if needed */
    } finally {
      setBusy(false);
    }
  }

  if (!me || items === null) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <Skeleton className="h-12" />
        <Skeleton className="h-64" />
      </main>
    );
  }

  const branding = me.tenant.branding ?? { themeCode: 'maple' };
  const fullName =
    [me.client.firstName, me.client.lastName].filter(Boolean).join(' ') || me.email;

  return (
    <ThemeProvider branding={branding}>
      <PortalShell firmName={me.tenant.displayName} clientName={fullName}>
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Secure conversation with {me.tenant.displayName}.
            </p>
          </div>

          <Card>
            <CardTitle>Conversation</CardTitle>
            <div
              ref={scrollRef}
              className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
            >
              {items.length === 0 ? (
                <div className="py-8 text-center text-xs text-[var(--color-text-muted)]">
                  <MessageSquare size={20} className="mx-auto mb-2 opacity-40" />
                  No messages yet. Send the first one below — your firm will get notified.
                </div>
              ) : (
                items.map((m) => <Bubble key={m.id} m={m} />)
              )}
            </div>
            <form onSubmit={send} className="mt-3 flex items-end gap-2">
              <textarea
                className="min-h-[60px] flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type your message…"
                maxLength={5000}
              />
              <Button type="submit" disabled={busy || body.trim().length === 0}>
                {busy ? <Spinner /> : <Send size={12} />} Send
              </Button>
            </form>
          </Card>
        </div>
      </PortalShell>
    </ThemeProvider>
  );
}

function Bubble({ m }: { m: Message }) {
  const isClient = m.sender === 'CLIENT';
  const isSystem = m.sender === 'SYSTEM';
  return (
    <div className={`flex ${isClient ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-[var(--radius-md)] px-3 py-2 text-sm ${
          isSystem
            ? 'border border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] italic'
            : isClient
              ? 'bg-[var(--color-primary)] text-[var(--color-text-on-primary)]'
              : 'border border-[var(--color-border-muted)] bg-[var(--color-surface)]'
        }`}
      >
        <div className="whitespace-pre-line">{m.body}</div>
        <div
          className={`mt-1 text-[10px] ${
            isClient
              ? 'text-[color-mix(in_srgb,var(--color-text-on-primary)_85%,transparent)]'
              : 'text-[var(--color-text-muted)]'
          }`}
        >
          {new Date(m.createdAt).toLocaleString()}
          {isClient
            ? m.readByStaff
              ? ' · seen'
              : ' · sent'
            : !m.readByClient
              ? ' · new'
              : ''}
        </div>
      </div>
    </div>
  );
}

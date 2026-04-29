'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { Badge, Button, Card, CardTitle, Spinner } from '@onsecboad/ui';
import { rpcMutation, rpcQuery } from '../../lib/api';
import { getAccessToken } from '../../lib/session';
import { useRealtime } from '../../lib/realtime';

type Sender = 'CLIENT' | 'STAFF' | 'SYSTEM';

type Message = {
  id: string;
  sender: Sender;
  senderUserId: string | null;
  body: string;
  createdAt: string;
  caseId: string | null;
  readByClient: string | null;
  readByStaff: string | null;
};

export function MessagesCard({
  clientId,
  caseId,
  onError,
}: {
  clientId: string;
  caseId?: string;
  onError: (m: string) => void;
}) {
  const [items, setItems] = useState<Message[] | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  async function load(): Promise<void> {
    try {
      const token = getAccessToken();
      const r = await rpcQuery<Message[]>(
        'message.thread',
        { clientId, ...(caseId ? { caseId } : {}) },
        { token },
      );
      setItems(r);
      // After-the-fact mark-read so unread badges decay automatically
      // when staff opens the case page.
      await rpcMutation(
        'message.markRead',
        { clientId, ...(caseId ? { caseId } : {}) },
        { token },
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load messages');
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, caseId]);

  // Refresh on SSE message.new events for this client.
  useRealtime((ev) => {
    if (ev.type === 'message.new' && ev.clientId === clientId) {
      void load();
    }
  });

  // Auto-scroll on new messages.
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
      const token = getAccessToken();
      await rpcMutation(
        'message.send',
        { clientId, body: trimmed, ...(caseId ? { caseId } : {}) },
        { token },
      );
      setBody('');
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between">
        <CardTitle>Messages</CardTitle>
        <Badge tone="neutral">{caseId ? 'this case' : 'all cases'}</Badge>
      </div>

      <div
        ref={scrollRef}
        className="mt-3 max-h-96 space-y-2 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border-muted)] bg-[var(--color-surface-muted)] p-3"
      >
        {items === null ? (
          <div className="text-xs text-[var(--color-text-muted)]">Loading…</div>
        ) : items.length === 0 ? (
          <div className="py-6 text-center text-xs text-[var(--color-text-muted)]">
            <MessageSquare size={20} className="mx-auto mb-2 opacity-40" />
            No messages yet. Send the first one below.
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
          placeholder={
            caseId
              ? 'Reply on this case…'
              : 'Reply to the client. Tagged to no specific case.'
          }
          maxLength={5000}
        />
        <Button type="submit" disabled={busy || body.trim().length === 0}>
          {busy ? <Spinner /> : <Send size={12} />} Send
        </Button>
      </form>
    </Card>
  );
}

function Bubble({ m }: { m: Message }) {
  const isStaff = m.sender === 'STAFF';
  const isSystem = m.sender === 'SYSTEM';
  return (
    <div className={`flex ${isStaff ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-[var(--radius-md)] px-3 py-2 text-sm ${
          isSystem
            ? 'border border-dashed border-[var(--color-border)] bg-transparent text-[var(--color-text-muted)] italic'
            : isStaff
              ? 'bg-[var(--color-primary)] text-[var(--color-text-on-primary)]'
              : 'border border-[var(--color-border-muted)] bg-[var(--color-surface)]'
        }`}
      >
        <div className="whitespace-pre-line">{m.body}</div>
        <div
          className={`mt-1 text-[10px] ${
            isStaff
              ? 'text-[color-mix(in_srgb,var(--color-text-on-primary)_85%,transparent)]'
              : 'text-[var(--color-text-muted)]'
          }`}
        >
          {new Date(m.createdAt).toLocaleString()}
          {isStaff
            ? m.readByClient
              ? ' · seen'
              : ' · sent'
            : !m.readByStaff
              ? ' · new'
              : ''}
        </div>
      </div>
    </div>
  );
}

'use client';
import { useEffect, useRef } from 'react';
import { getAccessToken } from './session';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type RealtimeEvent =
  | { type: 'lead.assigned'; leadId: string; assignedToId: string; firstName?: string; lastName?: string; phone?: string }
  | { type: 'lead.created'; leadId: string; source: string; branchId: string | null }
  | { type: 'sms.received'; smsId: string; leadId: string | null; from: string; bodyPreview: string }
  | { type: 'call.status'; callId: string; status: string; agentId: string | null; leadId: string | null }
  | { type: 'appointment.created'; appointmentId: string; scheduledAt: string; providerId: string }
  | { type: 'appointment.outcome'; appointmentId: string; outcome: string; leadId: string | null }
  | { type: 'case.status'; caseId: string; status: string }
  | {
      type: 'message.new';
      messageId: string;
      clientId: string;
      caseId: string | null;
      sender: 'CLIENT' | 'STAFF' | 'SYSTEM';
      bodyPreview: string;
    }
  | { type: 'ping'; t: number };

type Listener = (ev: RealtimeEvent) => void;

/**
 * Subscribe to the realtime SSE stream. Returns a disposer so the caller
 * can detach in their effect cleanup. Reconnects automatically when the
 * stream drops (EventSource does this for us; we just rebuild on auth
 * changes).
 *
 * Multiple subscribers can coexist on the same page — each opens its own
 * EventSource. That's cheap and avoids cross-component state coordination
 * for now; revisit if a single page ever holds 5+ stream consumers.
 */
export function useRealtime(onEvent: Listener): void {
  // Capture the latest callback in a ref so we don't tear down the stream
  // every render — the listener identity is unstable for inline arrow fns.
  const cbRef = useRef<Listener>(onEvent);
  useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    const url = `${API_BASE}/api/v1/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    function handle(this: EventSource, e: MessageEvent): void {
      try {
        const parsed = JSON.parse(e.data) as RealtimeEvent;
        cbRef.current(parsed);
      } catch {
        /* drop */
      }
    }
    // Listen on the typed event names + the default 'message' event.
    const types = [
      'lead.assigned',
      'lead.created',
      'sms.received',
      'call.status',
      'appointment.created',
      'appointment.outcome',
      'case.status',
      'ping',
    ];
    types.forEach((t) => es.addEventListener(t, handle));
    es.addEventListener('message', handle);

    return () => {
      types.forEach((t) => es.removeEventListener(t, handle));
      es.removeEventListener('message', handle);
      es.close();
    };
  }, []);
}

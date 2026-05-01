'use client';
import { useEffect, useRef } from 'react';
import { getPortalToken } from './portal-session';

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type PortalRealtimeEvent =
  | {
      type: 'message.new';
      messageId: string;
      clientId: string;
      caseId: string | null;
      sender: 'CLIENT' | 'STAFF' | 'SYSTEM';
      bodyPreview: string;
    }
  | { type: 'case.status'; caseId: string; status: string }
  | {
      type: 'appointment.created';
      appointmentId: string;
      scheduledAt: string;
      providerId: string;
    }
  | { type: 'ping'; t: number };

type Listener = (ev: PortalRealtimeEvent) => void;

/**
 * Subscribe to the portal SSE stream. Mirrors apps/web/src/lib/realtime.ts
 * but uses the portal token + the /portal/stream endpoint, which subscribes
 * to `tenant:<tenantId>:client:<clientId>` only — the client never sees
 * other clients' events.
 */
export function useRealtimePortal(onEvent: Listener): void {
  const cbRef = useRef<Listener>(onEvent);
  useEffect(() => {
    cbRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const token = getPortalToken();
    if (!token) return;
    const url = `${API_BASE}/api/v1/portal/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    function handle(this: EventSource, e: MessageEvent): void {
      try {
        const parsed = JSON.parse(e.data) as PortalRealtimeEvent;
        cbRef.current(parsed);
      } catch {
        /* drop */
      }
    }
    const types = ['message.new', 'case.status', 'appointment.created', 'ping'];
    types.forEach((t) => es.addEventListener(t, handle));
    es.addEventListener('message', handle);

    return () => {
      types.forEach((t) => es.removeEventListener(t, handle));
      es.removeEventListener('message', handle);
      es.close();
    };
  }, []);
}

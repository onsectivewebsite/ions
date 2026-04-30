'use client';
import { useEffect, useState } from 'react';

/**
 * Public status page — Phase 10.2.
 *
 * No auth, no tenant context. Renders /api/health/full on a 30-second
 * refresh. Real production uptime tracking should pair this with an
 * external uptime probe (Better Stack / Pingdom / etc) so a downed API
 * doesn't take its own status page with it; this page is the consumer-
 * facing summary, not the monitoring backbone.
 */

type ComponentStatus = 'ok' | 'degraded' | 'down';

type HealthResp = {
  overall: ComponentStatus;
  checkedAt: string;
  components: Array<{ name: string; status: ComponentStatus; detail?: string }>;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const TONE: Record<ComponentStatus, { color: string; bg: string; label: string }> = {
  ok: { color: '#15803D', bg: '#DCFCE7', label: 'Operational' },
  degraded: { color: '#B45309', bg: '#FEF3C7', label: 'Degraded' },
  down: { color: '#B91C1C', bg: '#FEE2E2', label: 'Down' },
};

const NAMES: Record<string, string> = {
  database: 'Database',
  redis: 'Realtime + queue',
  r2: 'Document storage',
  stripe: 'Payments',
  ai: 'AI services',
};

export default function StatusPage() {
  const [data, setData] = useState<HealthResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);

  async function load(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/health/full`);
      const j = (await res.json()) as HealthResp;
      setData(j);
      setLastFetched(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reach API');
    }
  }

  useEffect(() => {
    void load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <main
      style={{
        minHeight: '100vh',
        backgroundColor: '#FAFAF7',
        padding: 24,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        color: '#111827',
      }}
    >
      <div style={{ maxWidth: 720, margin: '32px auto' }}>
        <div style={{ marginBottom: 24 }}>
          <div
            style={{
              fontSize: 12,
              color: '#B5132B',
              fontWeight: 700,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            OnsecBoad
          </div>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 8 }}>System status</h1>
          <p style={{ color: '#6b7280', marginTop: 4 }}>
            Real-time health of OnsecBoad services. Refreshes every 30 seconds.
          </p>
        </div>

        {error ? (
          <div
            style={{
              borderRadius: 12,
              padding: 24,
              backgroundColor: TONE.down.bg,
              color: TONE.down.color,
              fontWeight: 600,
            }}
          >
            Unable to reach the status API. {error}
          </div>
        ) : !data ? (
          <div style={{ color: '#6b7280' }}>Loading…</div>
        ) : (
          <>
            <div
              style={{
                borderRadius: 12,
                padding: 24,
                backgroundColor: TONE[data.overall].bg,
                color: TONE[data.overall].color,
                fontSize: 18,
                fontWeight: 700,
                marginBottom: 16,
              }}
            >
              {data.overall === 'ok'
                ? 'All systems operational'
                : data.overall === 'degraded'
                  ? 'Some systems degraded'
                  : 'Service disruption'}
            </div>

            <div
              style={{
                backgroundColor: '#fff',
                borderRadius: 12,
                border: '1px solid #E5E5DF',
                overflow: 'hidden',
              }}
            >
              {data.components.map((c, i) => (
                <div
                  key={c.name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px 20px',
                    borderBottom:
                      i < data.components.length - 1 ? '1px solid #EFEFEA' : undefined,
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600 }}>{NAMES[c.name] ?? c.name}</div>
                    {c.detail ? (
                      <div style={{ color: '#6b7280', fontSize: 12, marginTop: 2 }}>
                        {c.detail}
                      </div>
                    ) : null}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: 'uppercase',
                      color: TONE[c.status].color,
                      backgroundColor: TONE[c.status].bg,
                      padding: '4px 10px',
                      borderRadius: 999,
                    }}
                  >
                    {TONE[c.status].label}
                  </span>
                </div>
              ))}
            </div>

            <p style={{ color: '#9ca3af', fontSize: 12, marginTop: 16, textAlign: 'center' }}>
              Last checked {lastFetched ? lastFetched.toLocaleString() : '—'} · Updated{' '}
              {new Date(data.checkedAt).toLocaleString()}
            </p>
          </>
        )}

        <p style={{ color: '#9ca3af', fontSize: 11, marginTop: 32, textAlign: 'center' }}>
          For SEV-1 issues affecting your firm, contact{' '}
          <a href="mailto:support@onsective.com" style={{ color: '#B5132B' }}>
            support@onsective.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}

'use client';
import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('global error boundary caught:', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          backgroundColor: '#FAFAF7',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
          color: '#111827',
        }}
      >
        <div style={{ maxWidth: 520, textAlign: 'center' }}>
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
          <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 16 }}>App crashed</h1>
          <p style={{ marginTop: 8, color: '#6b7280', fontSize: 14 }}>
            A fatal error stopped the app from rendering. This is logged on the server.
          </p>
          {error.digest ? (
            <p style={{ marginTop: 12, color: '#9ca3af', fontSize: 12, fontFamily: 'monospace' }}>
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            onClick={reset}
            style={{
              marginTop: 24,
              padding: '10px 20px',
              borderRadius: 8,
              backgroundColor: '#B5132B',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
          <p style={{ marginTop: 32, fontSize: 12, color: '#9ca3af' }}>
            Need help? Email{' '}
            <a href="mailto:support@onsective.com" style={{ color: '#B5132B' }}>
              support@onsective.com
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}

'use client';
import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('app error boundary caught:', error);
  }, [error]);

  return (
    <main
      style={{
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
        <h1 style={{ fontSize: 32, fontWeight: 700, marginTop: 16 }}>Something went wrong</h1>
        <p style={{ marginTop: 8, color: '#6b7280', fontSize: 14 }}>
          The page hit an unexpected error. Try again, and if it keeps happening let support know.
        </p>
        {error.digest ? (
          <p style={{ marginTop: 12, color: '#9ca3af', fontSize: 12, fontFamily: 'monospace' }}>
            Reference: {error.digest}
          </p>
        ) : null}
        <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={reset}
            style={{
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
            Try again
          </button>
          <Link
            href="/dashboard"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #E5E5DF',
              color: '#111827',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Go to dashboard
          </Link>
        </div>
        <p style={{ marginTop: 32, fontSize: 12, color: '#9ca3af' }}>
          Need help? Email{' '}
          <a href="mailto:support@onsective.com" style={{ color: '#B5132B' }}>
            support@onsective.com
          </a>
        </p>
      </div>
    </main>
  );
}

import Link from 'next/link';

export default function NotFound() {
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
      <div style={{ maxWidth: 480, textAlign: 'center' }}>
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
        <h1 style={{ fontSize: 56, fontWeight: 700, marginTop: 16, lineHeight: 1 }}>404</h1>
        <p style={{ marginTop: 12, fontSize: 18, fontWeight: 500 }}>Page not found</p>
        <p style={{ marginTop: 8, color: '#6b7280', fontSize: 14 }}>
          The page you&rsquo;re looking for doesn&rsquo;t exist or has moved.
        </p>
        <div style={{ marginTop: 24, display: 'flex', gap: 12, justifyContent: 'center' }}>
          <Link
            href="/dashboard"
            style={{
              display: 'inline-block',
              padding: '10px 20px',
              borderRadius: 8,
              backgroundColor: '#B5132B',
              color: '#fff',
              fontWeight: 600,
              fontSize: 14,
              textDecoration: 'none',
            }}
          >
            Go to dashboard
          </Link>
          <Link
            href="/sign-in"
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
            Sign in
          </Link>
        </div>
      </div>
    </main>
  );
}

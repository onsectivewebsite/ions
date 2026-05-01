import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export async function GET(): Promise<Response> {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#B5132B',
          color: '#ffffff',
          fontSize: 110,
          fontWeight: 700,
          letterSpacing: '-0.05em',
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          borderRadius: 36,
        }}
      >
        O
      </div>
    ),
    { width: 192, height: 192 },
  );
}

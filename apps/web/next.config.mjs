/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  poweredByHeader: false,
  // 'standalone' produces a tiny self-contained server bundle — Docker
  // image drops from ~700MB to ~150MB.
  output: 'standalone',
  experimental: {
    // typedRoutes: enable once Phase 1+ routes (firms, billing, audit, leads, …) land.
    typedRoutes: false,
  },
  transpilePackages: [
    '@onsecboad/ui',
    '@onsecboad/config',
    '@onsecboad/auth',
    '@onsecboad/db',
  ],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(self)' },
        ],
      },
    ];
  },
};

export default config;

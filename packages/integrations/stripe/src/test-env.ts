// Loaded by vitest before any test module is imported, so the env cache in
// @onsecboad/config sees these values on first read.
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'http://localhost:3000';
process.env.PORTAL_URL = 'http://localhost:3000/portal';
process.env.API_URL = 'http://localhost:4000';
process.env.PUBLIC_DOMAIN = 'localhost';
process.env.DATABASE_URL = 'postgresql://x:x@localhost:5433/x';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET = 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET = 'b'.repeat(40);
process.env.ENCRYPTION_KEY_BASE64 = 'c'.repeat(48);
process.env.WEBAUTHN_RP_ID = 'localhost';
process.env.WEBAUTHN_ORIGIN = 'http://localhost:3000';
process.env.STRIPE_DRY_RUN = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_dummy_secret';

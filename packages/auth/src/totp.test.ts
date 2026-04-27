import { describe, it, expect } from 'vitest';
import { TOTP, Secret } from 'otpauth';
import { beginTotpEnroll, verifyTotp } from './totp';

describe('totp', () => {
  it('issues a base32 secret and otpauth URI', async () => {
    const enroll = await beginTotpEnroll('user@example.com');
    expect(enroll.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enroll.uri).toMatch(/^otpauth:\/\/totp\//);
  });

  it('accepts a freshly generated code', async () => {
    const enroll = await beginTotpEnroll('a@b.c');
    const totp = new TOTP({
      issuer: 'OnsecBoad',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(enroll.secret),
    });
    const code = totp.generate();
    expect(verifyTotp(enroll.secret, code)).toBe(true);
  });

  it('rejects an obviously wrong code', async () => {
    const enroll = await beginTotpEnroll('a@b.c');
    expect(verifyTotp(enroll.secret, '000000')).toBe(false);
  });
});

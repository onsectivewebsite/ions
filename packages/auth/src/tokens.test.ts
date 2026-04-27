import { describe, it, expect } from 'vitest';
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashRefreshToken,
} from './tokens';

const SECRET = 'a'.repeat(64);

describe('tokens — access', () => {
  it('signs and verifies a JWT with the same secret', async () => {
    const { token, expiresAt } = await signAccessToken(
      { sub: 'u1', scope: 'firm', tenantId: 't1', roleId: 'r1' },
      SECRET,
      60,
    );
    expect(token.split('.').length).toBe(3);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    const claims = await verifyAccessToken(token, SECRET);
    expect(claims.sub).toBe('u1');
    expect(claims.scope).toBe('firm');
    expect(claims.tenantId).toBe('t1');
  });

  it('rejects a token signed with a different secret', async () => {
    const { token } = await signAccessToken({ sub: 'u', scope: 'platform' }, SECRET, 60);
    await expect(verifyAccessToken(token, SECRET + 'x')).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const { token } = await signAccessToken({ sub: 'u', scope: 'platform' }, SECRET, -1);
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
  });
});

describe('tokens — refresh', () => {
  it('produces a high-entropy refresh + matching sha256 hash', () => {
    const r = generateRefreshToken();
    expect(r.token.length).toBeGreaterThanOrEqual(64);
    expect(r.hash).toBe(hashRefreshToken(r.token));
  });

  it('hashRefreshToken is deterministic', () => {
    const t = 'token-value';
    expect(hashRefreshToken(t)).toBe(hashRefreshToken(t));
  });
});

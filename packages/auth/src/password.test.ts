import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('password', () => {
  it('hashes to a non-empty argon2id digest', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(h.startsWith('$argon2id$')).toBe(true);
  });

  it('round-trips a correct password', async () => {
    const h = await hashPassword('p@ssw0rd');
    expect(await verifyPassword(h, 'p@ssw0rd')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const h = await hashPassword('p@ssw0rd');
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('returns false for malformed hash without throwing', async () => {
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false);
  });

  it('produces unique hashes for the same password (random salt)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toEqual(b);
  });
});

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encryptString, decryptString } from './crypto';

let originalKey: string | undefined;

beforeEach(() => {
  originalKey = process.env.ENCRYPTION_KEY_BASE64;
  process.env.ENCRYPTION_KEY_BASE64 = randomBytes(32).toString('base64');
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY_BASE64;
  else process.env.ENCRYPTION_KEY_BASE64 = originalKey;
});

describe('crypto', () => {
  it('round-trips an ASCII string', () => {
    const c = encryptString('hello world');
    expect(c.split('.').length).toBe(3);
    expect(decryptString(c)).toBe('hello world');
  });

  it('round-trips a unicode string', () => {
    const s = '🔐 mañana — naïve café';
    expect(decryptString(encryptString(s))).toBe(s);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptString('same')).not.toEqual(encryptString('same'));
  });

  it('detects tampered ciphertext', () => {
    const c = encryptString('important');
    const [iv, enc, tag] = c.split('.');
    // Flip a byte in the auth tag — GCM must reject.
    const tagBytes = Buffer.from(tag!, 'base64url');
    tagBytes[0] = tagBytes[0]! ^ 0xff;
    const tampered = `${iv}.${enc}.${tagBytes.toString('base64url')}`;
    expect(() => decryptString(tampered)).toThrow();
  });

  it('detects modified IV', () => {
    const c = encryptString('important');
    const [iv, enc, tag] = c.split('.');
    const ivBytes = Buffer.from(iv!, 'base64url');
    ivBytes[0] = ivBytes[0]! ^ 0xff;
    const tampered = `${ivBytes.toString('base64url')}.${enc}.${tag}`;
    expect(() => decryptString(tampered)).toThrow();
  });

  it('rejects malformed payload', () => {
    expect(() => decryptString('not.valid')).toThrow();
  });

  it('throws when the key is missing', () => {
    delete process.env.ENCRYPTION_KEY_BASE64;
    expect(() => encryptString('x')).toThrow(/ENCRYPTION_KEY_BASE64/);
  });
});

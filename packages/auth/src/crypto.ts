import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function loadKey(): Buffer {
  const b64 = process.env.ENCRYPTION_KEY_BASE64;
  if (!b64) throw new Error('ENCRYPTION_KEY_BASE64 not set');
  const key = Buffer.from(b64, 'base64');
  if (key.length !== 32) throw new Error('ENCRYPTION_KEY_BASE64 must decode to 32 bytes');
  return key;
}

/** Encrypt UTF-8 plaintext to compact `iv.cipher.tag` (all base64url). */
export function encryptString(plain: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64url')}.${enc.toString('base64url')}.${tag.toString('base64url')}`;
}

export function decryptString(payload: string): string {
  const key = loadKey();
  const parts = payload.split('.');
  if (parts.length !== 3) throw new Error('Invalid ciphertext');
  const [ivB64, encB64, tagB64] = parts as [string, string, string];
  const iv = Buffer.from(ivB64, 'base64url');
  const enc = Buffer.from(encB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

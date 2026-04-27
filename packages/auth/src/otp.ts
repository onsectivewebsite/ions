import { createHash, randomInt } from 'node:crypto';

/** Generate a numeric OTP and its hash for storage. */
export function generateEmailOtp(digits = 6): { code: string; hash: string } {
  const min = 10 ** (digits - 1);
  const max = 10 ** digits;
  const code = String(randomInt(min, max));
  return { code, hash: hashOtp(code) };
}

export function hashOtp(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function verifyOtp(code: string, hash: string): boolean {
  return hashOtp(code) === hash;
}

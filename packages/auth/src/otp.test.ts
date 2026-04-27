import { describe, it, expect } from 'vitest';
import { generateEmailOtp, verifyOtp, hashOtp } from './otp';

describe('otp', () => {
  it('generates a numeric code of the requested length', () => {
    const six = generateEmailOtp(6);
    expect(six.code).toMatch(/^[0-9]{6}$/);
    const eight = generateEmailOtp(8);
    expect(eight.code).toMatch(/^[0-9]{8}$/);
  });

  it('verifies a code by its hash', () => {
    const { code, hash } = generateEmailOtp(6);
    expect(verifyOtp(code, hash)).toBe(true);
  });

  it('rejects a wrong code', () => {
    const { hash } = generateEmailOtp(6);
    expect(verifyOtp('000000', hash)).toBe(false);
  });

  it('hashOtp is deterministic', () => {
    expect(hashOtp('123456')).toBe(hashOtp('123456'));
  });
});

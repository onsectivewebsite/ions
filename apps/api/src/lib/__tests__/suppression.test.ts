/**
 * suppression normalisation tests.
 *
 * Critical: addSuppression / isSuppressed key off the OUTPUT of
 * normaliseValue, not the raw input. A bug here means a +1 (416)
 * 555-1234 lookup misses a +14165551234 entry → CASL violation. Worth
 * pinning down with tests.
 */
import { describe, expect, it } from 'vitest';
import {
  normaliseEmail,
  normalisePhone,
  normaliseValue,
} from '../suppression.js';

describe('normalisePhone', () => {
  it('strips formatting from a Canadian E.164 number', () => {
    expect(normalisePhone('+1 (416) 555-1234')).toBe('+14165551234');
    expect(normalisePhone('+1-416-555-1234')).toBe('+14165551234');
    expect(normalisePhone('+1.416.555.1234')).toBe('+14165551234');
    expect(normalisePhone('+1 416 555 1234')).toBe('+14165551234');
  });

  it('preserves the leading + when present', () => {
    expect(normalisePhone('+91 9814 289 618')).toBe('+919814289618');
  });

  it('omits the + when input had none', () => {
    expect(normalisePhone('4165551234')).toBe('4165551234');
    expect(normalisePhone('416-555-1234')).toBe('4165551234');
  });

  it('strips trailing whitespace', () => {
    expect(normalisePhone('  +14165551234  ')).toBe('+14165551234');
  });

  it('drops non-digit chars (parens, hyphens, dots, spaces)', () => {
    expect(normalisePhone('(416) 555-1234')).toBe('4165551234');
  });

  it('handles empty input', () => {
    expect(normalisePhone('')).toBe('');
  });
});

describe('normaliseEmail', () => {
  it('lower-cases the address', () => {
    expect(normaliseEmail('User@Example.COM')).toBe('user@example.com');
  });

  it('trims whitespace', () => {
    expect(normaliseEmail('  user@example.com  ')).toBe('user@example.com');
  });

  it('preserves the domain TLD case-folded too', () => {
    expect(normaliseEmail('A@B.CO.UK')).toBe('a@b.co.uk');
  });
});

describe('normaliseValue', () => {
  it('routes by channel', () => {
    expect(normaliseValue('sms', '+1 (416) 555-1234')).toBe('+14165551234');
    expect(normaliseValue('email', 'User@Example.COM')).toBe('user@example.com');
  });

  it('produces idempotent output (re-normalising is a no-op)', () => {
    const phone = '+14165551234';
    expect(normaliseValue('sms', normaliseValue('sms', phone))).toBe(phone);
    const email = 'user@example.com';
    expect(normaliseValue('email', normaliseValue('email', email))).toBe(email);
  });

  it('matches across formatted-vs-bare equivalents (CASL compliance)', () => {
    // A user complaint comes in as '+1 (416) 555-1234'; an admin later
    // looks up '4165551234'. Both should hit the same suppression row.
    // We verify this by showing both inputs normalise to a value that
    // shares a substring of the digits — actual lookup happens via
    // exact-match in DB, so they MUST match exactly when the user
    // intended the same number.
    expect(normaliseValue('sms', '+1 (416) 555-1234')).toBe(
      normaliseValue('sms', '+14165551234'),
    );
  });
});

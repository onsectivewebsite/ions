/**
 * Retainer template renderer tests.
 *
 * The renderer produces the LEGAL TEXT a client signs. Bugs here mean a
 * mis-named firm on a real retainer agreement — worth pinning.
 *
 * Pure functions, no Prisma. We pass plain literals shaped like the
 * Prisma `Pick<…>` arguments and check the output is what we expect.
 */
import { describe, expect, it } from 'vitest';
import {
  buildRetainerVars,
  DEFAULT_RETAINER_MD,
  renderTemplate,
} from '../retainer-render.js';

const TENANT = {
  displayName: 'Acme Immigration',
  legalName: 'Acme Immigration LLP',
  address: {
    line1: '123 Bay St',
    line2: 'Suite 400',
    city: 'Toronto',
    province: 'ON',
    postalCode: 'M5J 2T3',
    country: 'Canada',
  },
};

const CLIENT = {
  firstName: 'Aanya',
  lastName: 'Singh',
  email: 'aanya@example.com',
  phone: '+14165551234',
  language: 'en',
};

const LAWYER = { name: 'Priya Patel', email: 'priya@acme.example' };

const CASE_DATA = {
  caseType: 'work_permit',
  retainerFeeCents: 250000,
  totalFeeCents: 500000,
};

describe('renderTemplate', () => {
  it('substitutes a single token', () => {
    expect(renderTemplate('Hello {{client.first_name}}!', { 'client.first_name': 'Aanya' })).toBe(
      'Hello Aanya!',
    );
  });

  it('substitutes multiple tokens', () => {
    const out = renderTemplate('{{a}} and {{b}}', { a: '1', b: '2' });
    expect(out).toBe('1 and 2');
  });

  it('handles tokens with whitespace inside the braces', () => {
    expect(renderTemplate('{{ a }} {{  b   }}', { a: '1', b: '2' })).toBe('1 2');
  });

  it('passes unknown tokens through verbatim (so the author can see them)', () => {
    expect(renderTemplate('{{client.unknown_field}}', {})).toBe('{{client.unknown_field}}');
  });

  it('does not match malformed tokens', () => {
    // single brace, missing close, etc.
    expect(renderTemplate('{client.name}', { 'client.name': 'X' })).toBe('{client.name}');
    expect(renderTemplate('{{client.name', { 'client.name': 'X' })).toBe('{{client.name');
  });

  it('replaces every occurrence', () => {
    expect(
      renderTemplate('{{x}} {{x}} {{x}}', { x: 'foo' }),
    ).toBe('foo foo foo');
  });

  it('returns an empty string for empty input', () => {
    expect(renderTemplate('', { a: '1' })).toBe('');
  });
});

describe('buildRetainerVars', () => {
  it('composes a full vars map for a complete client', () => {
    const vars = buildRetainerVars({
      tenant: TENANT,
      client: CLIENT,
      lawyer: LAWYER,
      case_: CASE_DATA,
      todayIso: '2026-04-29',
    });
    expect(vars['client.name']).toBe('Aanya Singh');
    expect(vars['client.first_name']).toBe('Aanya');
    expect(vars['firm.name']).toBe('Acme Immigration');
    expect(vars['firm.legal_name']).toBe('Acme Immigration LLP');
    expect(vars['case.case_type']).toBe('work permit');
    expect(vars['case.retainer_fee']).toBe('CAD $2,500.00');
    expect(vars['case.total_fee']).toBe('CAD $5,000.00');
    expect(vars['lawyer.name']).toBe('Priya Patel');
    expect(vars['date.today']).toBe('2026-04-29');
  });

  it('falls back to "Client" when no name is provided', () => {
    const vars = buildRetainerVars({
      tenant: TENANT,
      client: { ...CLIENT, firstName: null, lastName: null },
      lawyer: LAWYER,
      case_: CASE_DATA,
      todayIso: '2026-04-29',
    });
    expect(vars['client.name']).toBe('Client');
    expect(vars['client.first_name']).toBe('');
    expect(vars['client.last_name']).toBe('');
  });

  it('renders an em-dash for missing money values', () => {
    const vars = buildRetainerVars({
      tenant: TENANT,
      client: CLIENT,
      lawyer: LAWYER,
      case_: { ...CASE_DATA, retainerFeeCents: null, totalFeeCents: null },
      todayIso: '2026-04-29',
    });
    expect(vars['case.retainer_fee']).toBe('—');
    expect(vars['case.total_fee']).toBe('—');
  });

  it('multi-line firm address: one part per line, dropping empties', () => {
    const vars = buildRetainerVars({
      tenant: { ...TENANT, address: { line1: '1 King', city: 'Ottawa', country: 'Canada' } },
      client: CLIENT,
      lawyer: LAWYER,
      case_: CASE_DATA,
      todayIso: '2026-04-29',
    });
    expect(vars['firm.address']).toBe('1 King\nOttawa\nCanada');
  });

  it('empty address renders as an empty string (not undefined)', () => {
    const vars = buildRetainerVars({
      tenant: { ...TENANT, address: null },
      client: CLIENT,
      lawyer: LAWYER,
      case_: CASE_DATA,
      todayIso: '2026-04-29',
    });
    expect(vars['firm.address']).toBe('');
  });

  it('replaces all underscores in case_type for human display', () => {
    const vars = buildRetainerVars({
      tenant: TENANT,
      client: CLIENT,
      lawyer: LAWYER,
      case_: { ...CASE_DATA, caseType: 'super_visa_renewal' },
      todayIso: '2026-04-29',
    });
    expect(vars['case.case_type']).toBe('super visa renewal');
  });
});

describe('DEFAULT_RETAINER_MD', () => {
  it('renders cleanly with no leftover {{tokens}} when given full vars', () => {
    const vars = buildRetainerVars({
      tenant: TENANT,
      client: CLIENT,
      lawyer: LAWYER,
      case_: CASE_DATA,
      todayIso: '2026-04-29',
    });
    const out = renderTemplate(DEFAULT_RETAINER_MD, vars);
    expect(out).not.toMatch(/\{\{[^}]+\}\}/);
    expect(out).toContain('Aanya Singh');
    expect(out).toContain('Acme Immigration');
    expect(out).toContain('CAD $2,500.00');
  });
});

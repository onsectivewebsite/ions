/**
 * case-finances pure-function unit tests.
 *
 * The interesting non-trivial logic lives in lineAmountCents (qty * unit
 * + tax with rounding) and computeInvoiceTotals (sum + tax derivation).
 * The DB-touching helpers (recomputeCaseFinances, refreshInvoiceStatuses,
 * nextInvoiceNumber) are integration-level and need a Prisma mock or a
 * real db; deferred to a follow-up integration suite.
 */
import { describe, expect, it } from 'vitest';
import {
  computeInvoiceTotals,
  lineAmountCents,
} from '../case-finances.js';

describe('lineAmountCents', () => {
  it('returns qty × unit when tax is zero', () => {
    expect(lineAmountCents(1, 1000, 0)).toBe(1000);
    expect(lineAmountCents(3, 2500, 0)).toBe(7500);
  });

  it('applies basis-point tax', () => {
    // 13% HST = 1300 bp
    expect(lineAmountCents(1, 10000, 1300)).toBe(11300);
    expect(lineAmountCents(2, 10000, 1300)).toBe(22600);
  });

  it('rounds to the nearest cent', () => {
    // 5% of 333 = 16.65 → rounds to 17. 333 + 17 = 350.
    expect(lineAmountCents(1, 333, 500)).toBe(350);
    // 5% of 100 = 5. Exact.
    expect(lineAmountCents(1, 100, 500)).toBe(105);
  });

  it('handles very small amounts without losing precision', () => {
    // 1¢ × 13% = 0.13¢ → rounds to 0 → total 1.
    expect(lineAmountCents(1, 1, 1300)).toBe(1);
  });

  it('handles zero quantity gracefully', () => {
    expect(lineAmountCents(0, 10000, 1300)).toBe(0);
  });
});

describe('computeInvoiceTotals', () => {
  it('sums an empty list to zeros', () => {
    expect(computeInvoiceTotals([])).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
  });

  it('sums subtotal across line items', () => {
    const items = [
      { quantity: 1, unitPriceCents: 10000, taxRateBp: 0, amountCents: 10000 },
      { quantity: 2, unitPriceCents: 5000, taxRateBp: 0, amountCents: 10000 },
    ];
    const totals = computeInvoiceTotals(items);
    expect(totals.subtotalCents).toBe(20000);
    expect(totals.totalCents).toBe(20000);
    expect(totals.taxCents).toBe(0);
  });

  it('derives tax from amount minus subtotal', () => {
    // Two items, 13% HST each.
    const items = [
      { quantity: 1, unitPriceCents: 10000, taxRateBp: 1300, amountCents: 11300 },
      { quantity: 1, unitPriceCents: 5000, taxRateBp: 1300, amountCents: 5650 },
    ];
    const totals = computeInvoiceTotals(items);
    expect(totals.subtotalCents).toBe(15000);
    expect(totals.totalCents).toBe(16950);
    expect(totals.taxCents).toBe(1950);
  });

  it('handles mixed tax rates', () => {
    const items = [
      { quantity: 1, unitPriceCents: 10000, taxRateBp: 1300, amountCents: 11300 }, // 13% HST
      { quantity: 1, unitPriceCents: 10000, taxRateBp: 500, amountCents: 10500 }, // 5% GST
      { quantity: 1, unitPriceCents: 10000, taxRateBp: 0, amountCents: 10000 }, // tax-exempt
    ];
    const totals = computeInvoiceTotals(items);
    expect(totals.subtotalCents).toBe(30000);
    expect(totals.totalCents).toBe(31800);
    expect(totals.taxCents).toBe(1800);
  });

  it('matches lineAmountCents output (round-trip invariant)', () => {
    // Whatever lineAmountCents produces should sum to totalCents.
    const lines: Array<{
      quantity: number;
      unitPriceCents: number;
      taxRateBp: number;
    }> = [
      { quantity: 1, unitPriceCents: 333, taxRateBp: 500 }, // 350
      { quantity: 5, unitPriceCents: 199, taxRateBp: 1300 }, // 5 × 199 × 1.13 = 1124.35 → 1124
      { quantity: 2, unitPriceCents: 12500, taxRateBp: 0 }, // 25000
    ];
    const items = lines.map((l) => ({
      ...l,
      amountCents: lineAmountCents(l.quantity, l.unitPriceCents, l.taxRateBp),
    }));
    const totals = computeInvoiceTotals(items);
    const itemSum = items.reduce((s, i) => s + i.amountCents, 0);
    expect(totals.totalCents).toBe(itemSum);
  });
});

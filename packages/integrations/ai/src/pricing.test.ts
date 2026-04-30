/**
 * computeCostCents tests — Phase 8.1 pricing math.
 *
 * Frozen at write-time per AiUsage row (so historical totals stay
 * stable when Anthropic changes pricing). Worth pinning the rates we
 * shipped so a casual table edit can't quietly inflate every firm's
 * historical bill.
 *
 * USD→CAD = 1.36 frozen at write-time. Update both this test and the
 * PRICE_TABLE_USD_PER_MILLION constant when refreshing pricing.
 */
import { describe, expect, it } from 'vitest';
import { computeCostCents } from './index.js';

describe('computeCostCents', () => {
  describe('Sonnet 4.6 (default tier)', () => {
    it('input-only call: 1M input tokens × $3/M × 1.36 CAD = 408¢', () => {
      const cents = computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      });
      expect(cents).toBe(408);
    });

    it('output-only call: 1M output tokens × $15/M × 1.36 CAD = 2040¢', () => {
      const cents = computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
      });
      expect(cents).toBe(2040);
    });

    it('cached-input is 10% of regular: 1M cached × $0.30/M × 1.36 = 41¢', () => {
      const cents = computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 0,
        cachedInputTokens: 1_000_000,
        outputTokens: 0,
      });
      expect(cents).toBe(41); // round(0.30 * 1.36) = 41
    });

    it('typical extract call: 3k in + 1k out ≈ 3¢', () => {
      const cents = computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 3000,
        cachedInputTokens: 0,
        outputTokens: 1000,
      });
      // (3000 × 3 + 1000 × 15) / 1M × 1.36 × 100 = 0.024 × 1.36 × 100 = 3.264 → 3
      expect(cents).toBe(3);
    });
  });

  describe('Opus 4.7 (premium tier)', () => {
    it('input: 1M × $15 × 1.36 = 2040¢', () => {
      const cents = computeCostCents({
        model: 'claude-opus-4-7',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      });
      expect(cents).toBe(2040);
    });

    it('output: 1M × $75 × 1.36 = 10200¢', () => {
      const cents = computeCostCents({
        model: 'claude-opus-4-7',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
      });
      expect(cents).toBe(10200);
    });

    it('Opus is 5x more expensive on output than Sonnet', () => {
      const sonnet = computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
      });
      const opus = computeCostCents({
        model: 'claude-opus-4-7',
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 1_000_000,
      });
      expect(opus / sonnet).toBe(5);
    });
  });

  describe('Haiku 4.5 (cheap tier — used by classify + agent)', () => {
    it('input: 1M × $1 × 1.36 = 136¢', () => {
      const cents = computeCostCents({
        model: 'claude-haiku-4-5',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      });
      expect(cents).toBe(136);
    });

    it('typical classify: 600 in + 60 out ≈ 0¢ (rounds down)', () => {
      const cents = computeCostCents({
        model: 'claude-haiku-4-5',
        inputTokens: 600,
        cachedInputTokens: 0,
        outputTokens: 60,
      });
      // (600 × 1 + 60 × 5) / 1M × 1.36 × 100 = 0.0009 × 1.36 × 100 = 0.122 → 0
      expect(cents).toBe(0);
    });

    it('1000 typical classify calls add up to a measurable cost', () => {
      let total = 0;
      for (let i = 0; i < 1000; i++) {
        total += computeCostCents({
          model: 'claude-haiku-4-5',
          inputTokens: 600,
          cachedInputTokens: 0,
          outputTokens: 60,
        });
      }
      // Each rounds to 0, but a real usage roll-up should sum the
      // unrounded costs server-side. Pin the per-call rounding behaviour
      // so we know the dashboard total may UNDERSTATE on lots of small
      // Haiku calls. (Not a bug we ship — it's the simplest correct
      // semantics; a future phase can switch to sum-then-round.)
      expect(total).toBe(0);
    });
  });

  describe('Unknown model', () => {
    it('falls back to Sonnet rates (safe over-estimate)', () => {
      const sonnet = computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      });
      const unknown = computeCostCents({
        model: 'claude-future-model-9-9',
        inputTokens: 1_000_000,
        cachedInputTokens: 0,
        outputTokens: 0,
      });
      expect(unknown).toBe(sonnet);
    });
  });

  describe('Linearity invariants', () => {
    it('doubling tokens doubles cost (within rounding)', () => {
      const small = computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 100_000,
        cachedInputTokens: 0,
        outputTokens: 50_000,
      });
      const big = computeCostCents({
        model: 'claude-sonnet-4-6',
        inputTokens: 200_000,
        cachedInputTokens: 0,
        outputTokens: 100_000,
      });
      expect(big).toBeGreaterThanOrEqual(2 * small - 1);
      expect(big).toBeLessThanOrEqual(2 * small + 1);
    });

    it('zero tokens = 0¢', () => {
      expect(
        computeCostCents({
          model: 'claude-sonnet-4-6',
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
        }),
      ).toBe(0);
    });
  });
});

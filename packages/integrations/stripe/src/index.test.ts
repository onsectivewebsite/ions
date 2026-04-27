import { describe, it, expect, beforeAll } from 'vitest';
import {
  stripeMode,
  isDryRun,
  createCustomer,
  createSubscription,
  createSetupIntent,
  verifyWebhookSignature,
} from './index';

describe('stripe stub (dry-run)', () => {
  beforeAll(() => {
    expect(stripeMode).toBe('dry-run');
    expect(isDryRun()).toBe(true);
  });

  it('createCustomer returns a fake cus_ id', async () => {
    const c = await createCustomer({ email: 'a@b.c', name: 'X', tenantId: 't1' });
    expect(c.id).toMatch(/^cus_dryrun_/);
  });

  it('createSubscription respects trialDays', async () => {
    const noTrial = await createSubscription({
      customerId: 'cus_x',
      priceId: 'price_dummy_starter',
      quantity: 1,
      tenantId: 't1',
    });
    expect(noTrial.status).toBe('active');
    expect(noTrial.trialEnd).toBeNull();

    const withTrial = await createSubscription({
      customerId: 'cus_x',
      priceId: 'price_dummy_growth',
      quantity: 3,
      trialDays: 14,
      tenantId: 't1',
    });
    expect(withTrial.status).toBe('trialing');
    expect(withTrial.trialEnd).toBeInstanceOf(Date);
  });

  it('createSetupIntent returns a client_secret-shaped string', async () => {
    const si = await createSetupIntent('cus_x');
    expect(si.clientSecret).toMatch(/secret/);
  });

  it('verifyWebhookSignature accepts plain JSON in dry-run', () => {
    const payload = JSON.stringify({ id: 'evt_1', type: 'invoice.finalized', data: { object: {} } });
    const r = verifyWebhookSignature(payload, undefined);
    expect(r.ok).toBe(true);
    expect(r.event.id).toBe('evt_1');
    expect(r.event.type).toBe('invoice.finalized');
  });
});

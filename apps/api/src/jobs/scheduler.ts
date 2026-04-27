/**
 * In-process job scheduler. Cheap and good enough for the single-process API
 * we ship in Phase 0–2. When we move to multi-replica deploys (Phase 3+),
 * swap this for BullMQ on Redis (already running) with leader election so
 * only one worker fires each scheduled job.
 *
 * Gated by ENABLE_CRON=true so local dev stays quiet by default. Set the env
 * to true on the prod API process; leave it false on every other instance.
 */
import cron from 'node-cron';
import { loadEnv } from '@onsecboad/config';
import { logger } from '../logger.js';
import { reconcileAllSeats } from './seat-reconcile.js';

const env = loadEnv();

let started = false;

export function startScheduledJobs(): void {
  if (started) return;
  started = true;
  if (!env.ENABLE_CRON) {
    logger.info('cron disabled (ENABLE_CRON=false) — skipping scheduled jobs');
    return;
  }
  if (!cron.validate(env.CRON_SEAT_RECONCILE)) {
    logger.error({ expr: env.CRON_SEAT_RECONCILE }, 'invalid CRON_SEAT_RECONCILE expression');
    return;
  }
  cron.schedule(env.CRON_SEAT_RECONCILE, async () => {
    const start = Date.now();
    logger.info('cron: seat reconcile starting');
    try {
      const r = await reconcileAllSeats();
      logger.info(
        { ...r, ms: Date.now() - start },
        `cron: seat reconcile done — scanned ${r.scanned}, drifted ${r.drifted}, errors ${r.errors}`,
      );
    } catch (e) {
      logger.error({ err: e }, 'cron: seat reconcile threw');
    }
  });
  logger.info({ schedule: env.CRON_SEAT_RECONCILE }, 'cron: seat reconcile scheduled');
}

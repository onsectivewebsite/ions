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
import { aiAgentTick } from './ai-agent-tick.js';
import { dataPurgeTick } from './data-purge.js';
import { auditPurgeTick } from './audit-purge.js';
import { abuseAlertsTick } from './abuse-alerts.js';
import { calendarSyncTick } from './calendar-sync.js';

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

  // Phase 8.3 — daily missing-docs agent tick.
  if (!cron.validate(env.CRON_AI_AGENT_TICK)) {
    logger.error({ expr: env.CRON_AI_AGENT_TICK }, 'invalid CRON_AI_AGENT_TICK expression');
  } else {
    cron.schedule(env.CRON_AI_AGENT_TICK, async () => {
      const start = Date.now();
      logger.info('cron: ai agent tick starting');
      try {
        const r = await aiAgentTick();
        logger.info(
          { ...r, ms: Date.now() - start },
          `cron: ai agent tick done — tenants ${r.tenantsScanned}, candidates ${r.candidates}, done ${r.done}, skipped ${r.skipped}, errors ${r.errors}`,
        );
      } catch (e) {
        logger.error({ err: e }, 'cron: ai agent tick threw');
      }
    });
    logger.info({ schedule: env.CRON_AI_AGENT_TICK }, 'cron: ai agent tick scheduled');
  }

  // Phase 10.1 — daily PIPEDA data purge.
  if (!cron.validate(env.CRON_DATA_PURGE)) {
    logger.error({ expr: env.CRON_DATA_PURGE }, 'invalid CRON_DATA_PURGE expression');
  } else {
    cron.schedule(env.CRON_DATA_PURGE, async () => {
      const start = Date.now();
      logger.info('cron: data purge starting');
      try {
        const r = await dataPurgeTick();
        logger.info(
          { ...r, ms: Date.now() - start },
          `cron: data purge done — scanned ${r.scanned}, purged ${r.purged}, errors ${r.errors}`,
        );
      } catch (e) {
        logger.error({ err: e }, 'cron: data purge threw');
      }
    });
    logger.info({ schedule: env.CRON_DATA_PURGE }, 'cron: data purge scheduled');
  }

  // Stage 16.2 — every 15 minutes, pull busy slots from connected
  // external calendars so the booking flow can warn about overlaps.
  cron.schedule('*/15 * * * *', async () => {
    const start = Date.now();
    try {
      const r = await calendarSyncTick();
      logger.info(
        { ...r, ms: Date.now() - start },
        `cron: calendar sync done — connections ${r.connections}, slots ${r.slotsUpserted}, errors ${r.errors}`,
      );
    } catch (e) {
      logger.error({ err: e }, 'cron: calendar sync threw');
    }
  });
  logger.info('cron: calendar sync scheduled (every 15 min)');

  // Stage 15.2 — hourly abuse-signal alerts to Onsective ops.
  if (cron.validate(env.CRON_ABUSE_ALERTS)) {
    cron.schedule(env.CRON_ABUSE_ALERTS, async () => {
      const start = Date.now();
      logger.info('cron: abuse alerts starting');
      try {
        const r = await abuseAlertsTick();
        logger.info(
          { ...r, ms: Date.now() - start },
          `cron: abuse alerts done — scanned ${r.scanned}, alerts ${r.alerts}, emailed ${r.emailed}, errors ${r.errors}`,
        );
      } catch (e) {
        logger.error({ err: e }, 'cron: abuse alerts threw');
      }
    });
    logger.info({ schedule: env.CRON_ABUSE_ALERTS }, 'cron: abuse alerts scheduled');
  }

  // Stage 5.2 + 8.4 — daily audit log purge respecting per-tenant retention.
  // Reuses CRON_DATA_PURGE schedule since both run in the small hours.
  if (cron.validate(env.CRON_DATA_PURGE)) {
    cron.schedule(env.CRON_DATA_PURGE, async () => {
      const start = Date.now();
      logger.info('cron: audit purge starting');
      try {
        const r = await auditPurgeTick();
        logger.info(
          { ...r, ms: Date.now() - start },
          `cron: audit purge done — tenants ${r.tenantsScanned}, deleted ${r.rowsDeleted}, errors ${r.errors}`,
        );
      } catch (e) {
        logger.error({ err: e }, 'cron: audit purge threw');
      }
    });
    logger.info({ schedule: env.CRON_DATA_PURGE }, 'cron: audit purge scheduled');
  }
}

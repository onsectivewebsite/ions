/**
 * Expo Push delivery — Phase 9.5.
 *
 * One thin client around https://exp.host/--/api/v2/push/send. We don't
 * use @expo/server-sdk because (a) it pulls a tree of deps for marginal
 * value, (b) the API is plain JSON. Best-effort: failures log + swallow
 * so a flaky push doesn't break the originating mutation.
 *
 * Stub-aware via PUSH_DRY_RUN — defaults to true so dev doesn't try to
 * fan out to phantom tokens.
 */
import { loadEnv } from '@onsecboad/config';
import { prisma, type PrismaClient } from '@onsecboad/db';
import { logger } from '../logger.js';

const env = loadEnv();

export type PushNotification = {
  title: string;
  body: string;
  /** Routed to the notification tap handler on the device. Use this to
   *  encode { kind, id } so the mobile shell can router.push to the
   *  right deep-link. */
  data?: Record<string, unknown>;
  /** Default 'default'; staff/client apps can stash custom sounds. */
  sound?: 'default' | null;
};

type ExpoMessage = {
  to: string | string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
};

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendBatch(messages: ExpoMessage[]): Promise<void> {
  if (env.PUSH_DRY_RUN) {
    // eslint-disable-next-line no-console
    console.log('[push:dry-run]', messages.map((m) => ({ to: m.to, title: m.title })));
    return;
  }
  if (messages.length === 0) return;
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'accept-encoding': 'gzip, deflate',
        'content-type': 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      logger.warn({ status: res.status, body: txt.slice(0, 500) }, 'expo push send failed');
      return;
    }
    // Expo returns per-message receipts. We don't act on DeviceNotRegistered
    // here; a follow-up tick can prune stale tokens. Phase 9.5+ work.
    const json = (await res.json().catch(() => null)) as
      | { data?: Array<{ status?: string; details?: { error?: string } }> }
      | null;
    const errors = (json?.data ?? []).filter((d) => d.status === 'error');
    if (errors.length > 0) {
      logger.warn({ count: errors.length, sample: errors[0] }, 'expo push partial errors');
    }
  } catch (e) {
    logger.warn({ err: e }, 'expo push throw');
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  if (arr.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function tokensForUsers(
  prismaClient: PrismaClient,
  userIds: string[],
): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await prismaClient.pushDevice.findMany({
    where: { userId: { in: userIds }, variant: 'staff' },
    select: { expoPushToken: true },
  });
  return rows.map((r) => r.expoPushToken);
}

async function tokensForClientAccounts(
  prismaClient: PrismaClient,
  accountIds: string[],
): Promise<string[]> {
  if (accountIds.length === 0) return [];
  const rows = await prismaClient.pushDevice.findMany({
    where: { clientPortalAccountId: { in: accountIds }, variant: 'client' },
    select: { expoPushToken: true },
  });
  return rows.map((r) => r.expoPushToken);
}

async function fanOut(
  tokens: string[],
  notification: PushNotification,
): Promise<void> {
  if (tokens.length === 0) return;
  const messages: ExpoMessage[] = tokens.map((to) => ({
    to,
    title: notification.title,
    body: notification.body,
    data: notification.data,
    sound: notification.sound ?? 'default',
    priority: 'high',
    channelId: 'default',
  }));
  // Expo recommends batches of ≤100.
  for (const c of chunk(messages, 100)) await sendBatch(c);
}

export async function pushToUsers(
  userIds: string[],
  notification: PushNotification,
): Promise<void> {
  try {
    const tokens = await tokensForUsers(prisma, userIds);
    await fanOut(tokens, notification);
  } catch (err) {
    logger.warn({ err }, 'pushToUsers failed');
  }
}

export async function pushToClientAccounts(
  accountIds: string[],
  notification: PushNotification,
): Promise<void> {
  try {
    const tokens = await tokensForClientAccounts(prisma, accountIds);
    await fanOut(tokens, notification);
  } catch (err) {
    logger.warn({ err }, 'pushToClientAccounts failed');
  }
}

/**
 * Resolve a Client → ClientPortalAccount IDs. Convenience for
 * message.send → push.client.
 */
export async function clientAccountsForClient(
  prismaClient: PrismaClient,
  clientId: string,
): Promise<string[]> {
  const rows = await prismaClient.clientPortalAccount.findMany({
    where: { clientId, status: 'ACTIVE' },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

import Redis from 'ioredis';
import { loadEnv } from '@onsecboad/config';

const env = loadEnv();
export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
});

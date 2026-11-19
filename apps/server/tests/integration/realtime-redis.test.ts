import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from 'redis';
import { RealtimeRedis } from '../../src/modules/realtime/services/redis.js';
import type { Exam } from '../../src/modules/realtime/services/repository.js';

const redisUrl = process.env.AUTH_REDIS_URL;

describe.skipIf(!redisUrl)('Realtime with the Auth Redis client', () => {
  const redis = createClient({
    url: redisUrl,
    socket: { reconnectStrategy: false },
  });
  const prefix = `oe:dev:v1:test:${randomUUID()}`;
  const cache = new RealtimeRedis(redis, prefix);
  const examId = randomUUID();
  const attemptId = randomUUID();
  const exam: Exam = {
    id: examId,
    owner_id: randomUUID(),
    room_code: 'K7M2QX',
    status: 'RUNNING',
    start_time: new Date(Date.now() - 1000),
    end_time: new Date(Date.now() + 60_000),
    duration_sec: 60,
  };

  beforeAll(async () => redis.connect());
  afterAll(async () => {
    if (!redis.isOpen) return;
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(keys);
    await redis.quit();
  });

  it('runs rate limits, clock cache, and presence using node-redis', async () => {
    await cache.rateLimit('user', 'room:join', 2);
    await cache.rateLimit('user', 'room:join', 2);
    await expect(cache.rateLimit('user', 'room:join', 2)).rejects.toMatchObject(
      {
        code: 'RATE_LIMITED',
      },
    );

    await cache.cacheRuntime(exam);
    expect(await redis.hGet(`${prefix}:exam:${examId}:runtime`, 'status')).toBe(
      'RUNNING',
    );

    expect(await cache.heartbeat(exam, attemptId)).toBe(true);
    expect(await cache.heartbeat(exam, attemptId)).toBe(false);
    expect(await cache.lastHeartbeat(examId, attemptId)).toBeTypeOf('number');
    expect(await cache.offlineCandidates(examId, Date.now() + 1000)).toEqual([
      attemptId,
    ]);
    expect(await cache.markOffline(examId, attemptId, Date.now() + 1000)).toBe(
      true,
    );
    expect(await cache.markOffline(examId, attemptId, Date.now() + 1000)).toBe(
      false,
    );
    expect(await cache.heartbeat(exam, attemptId)).toBe(true);
    await cache.removePresence(examId, attemptId);
    expect(await cache.lastHeartbeat(examId, attemptId)).toBeNull();
  });
});

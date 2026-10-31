/* ĐIỂM TÍCH HỢP PUBLIC CỦA MODULE REALTIME (COMPOSITION ROOT) */

export { createRealtimeGateway } from './handlers/gateway.js';
export { RealtimeRepository } from './services/repository.js';
export { RealtimeRedis } from './services/redis.js';
export { RealtimeService } from './services/service.js';
export { RealtimeWorker } from './jobs/worker.js';

import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import type { Store } from 'express-session';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { createRealtimeGateway } from './handlers/gateway.js';
import { RealtimeRepository } from './services/repository.js';
import { RealtimeRedis } from './services/redis.js';
import { RealtimeService } from './services/service.js';
import { RealtimeWorker } from './jobs/worker.js';

// Hàm gắn toàn bộ module vào server đang chạy; tạo instance và khởi động worker
export async function mountRealtime(options: {
  httpServer: HttpServer;
  sessionMiddleware: RequestHandler;
  sessionStore: Store;
  pool: Pool;
  redis: Redis;
  clientOrigin: string;
  environment: 'dev' | 'staging' | 'prod';
  logger?: Pick<Console, 'error'>;
}) {
  const cache = new RealtimeRedis(
    options.redis,
    `oe:${options.environment}:v1`,
  );
  const service = new RealtimeService(
    new RealtimeRepository(options.pool),
    cache,
    options.logger,
  );
  const gateway = createRealtimeGateway({ ...options, service });
  const worker = new RealtimeWorker(service, gateway, options.logger);
  try {
    await worker.start();
  } catch (error) {
    await gateway.close();
    throw error;
  }
  return {
    gateway,
    worker,
    async close() {
      worker.stop();
      await gateway.close();
    },
  };
}

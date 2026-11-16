/* ĐIỂM TÍCH HỢP PUBLIC CỦA MODULE REALTIME (COMPOSITION ROOT) */

export { createRealtimeGateway } from './handlers/gateway.js';
export { RealtimeRepository } from './services/repository.js';
export { RealtimeRedis } from './services/redis.js';
export { RealtimeService } from './services/service.js';
export { RealtimeWorker } from './jobs/worker.js';

import type { Pool } from 'pg';
import type { Namespace } from 'socket.io';
import type { AuthSessions } from '../auth/session.js';
import type { AuthRedis } from '../auth/services/session-store.js';
import { createRealtimeGateway } from './handlers/gateway.js';
import { RealtimeRepository } from './services/repository.js';
import { RealtimeRedis } from './services/redis.js';
import { RealtimeService } from './services/service.js';
import { RealtimeWorker } from './jobs/worker.js';

// Hàm gắn toàn bộ module vào server đang chạy; tạo instance và khởi động worker
export async function mountRealtime(options: {
  namespace: Namespace;
  sessions: AuthSessions;
  pool: Pool;
  redis: AuthRedis;
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
    worker.stop();
    gateway.close();
    throw error;
  }
  return {
    gateway,
    worker,
    close() {
      worker.stop();
      gateway.close();
    },
  };
}

# Backend Realtime

Module `src/modules/realtime` gắn Socket.IO vào HTTP server Express hiện có. Module Auth/REST chưa được triển khai trong repository này; Realtime nhận `sessionMiddleware`, `sessionStore`, PostgreSQL pool và Redis client từ bootstrap chung. Không chạy Socket.IO server riêng.

- `handlers/gateway.ts`: handshake, ACK, room và phát sự kiện Socket.IO.
- `jobs/worker.ts`: đồng bộ timer, quét offline và chốt bài hết giờ.
- `services/`: nghiệp vụ Realtime, truy cập PostgreSQL và Redis.
- `errors.ts`, `index.ts`: lỗi dùng chung và điểm gắn module vào server.

```ts
import { mountRealtime } from './src/modules/realtime/index.js';

const realtime = await mountRealtime({
  httpServer, sessionMiddleware, sessionStore, pool, redis,
  clientOrigin: process.env.CLIENT_ORIGIN!,
  environment: 'dev',
});

// Khi Auth thay session, gọi sau khi con trỏ active_session đã commit:
realtime.gateway.notifySessionReplaced(userId, oldSid);

// Sau khi REST nộp bài hoặc lưu đáp án thành công:
realtime.gateway.emitSubmitted(submitted); // chỉ khi trạng thái vừa chuyển sang submitted
await realtime.gateway.emitStudentUpdate(attemptId);

// Trong shutdown handler:
await realtime.close();
```

Session phải lưu `userId` và `role` ở cấp cao nhất; `sessionStore` và middleware là cùng instance với REST. Auth quản lý `oe:<env>:v1:sess:<sid>` và `oe:<env>:v1:auth:user:<userId>:active_session` như [Redis Key Schema](../../docs/redis-key-schema.md). Redis client dùng logical DB 0. `mountRealtime` khởi động worker sau khi kết nối PostgreSQL/Redis sẵn sàng. Worker chốt bài sau `endTime + 5 giây`; nếu process dừng, lần khởi động kế tiếp sẽ quét lại DB.

Lệnh trong `apps/server`: `npm install`, `npm run check`, `npm test`, `npm run build`. Chi tiết event và ACK ở [WebSocket contract](../../docs/ws-events.md).

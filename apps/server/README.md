# Backend Realtime

`src/index.ts` tạo một HTTP server và một Socket.IO server. Auth xác thực cookie/session trên namespace `/exam`; module realtime gắn handler và worker vào namespace đó. PostgreSQL pool và Redis client được dùng chung trong bootstrap.

- `handlers/gateway.ts`: ACK, room và phát sự kiện Socket.IO; Auth quản lý handshake và thu hồi session.
- `jobs/worker.ts`: đồng bộ timer, quét offline và chốt bài hết giờ.
- `services/`: nghiệp vụ Realtime, truy cập PostgreSQL và Redis.
- `errors.ts`, `index.ts`: lỗi dùng chung và điểm gắn module vào server.

```ts
import { WS_NAMESPACE } from '@online-exam/shared';
import { mountRealtime } from './modules/realtime/index.js';

const realtime = await mountRealtime({
  namespace: io.of(WS_NAMESPACE),
  sessions,
  pool,
  redis,
  environment: 'dev',
});

// Sau khi REST nộp bài hoặc lưu đáp án thành công:
realtime.gateway.emitSubmitted(submitted); // chỉ khi trạng thái vừa chuyển sang submitted
await realtime.gateway.emitStudentUpdate(attemptId);

// Trong shutdown handler:
realtime.close();
```

Session lưu `userId` và `role` ở cấp cao nhất. Auth quản lý `oe:<env>:v1:sess:<sid>` và `oe:<env>:v1:auth:user:<userId>:active_session` như [Redis Key Schema](../../docs/redis-key-schema.md). Realtime dùng cùng Redis client của Auth. `mountRealtime` khởi động worker sau khi kết nối PostgreSQL/Redis sẵn sàng. Worker chốt bài sau `endTime + 5 giây`; nếu process dừng, lần khởi động kế tiếp sẽ quét lại DB.

Lệnh ở workspace root: `pnpm install`, `pnpm check`, `pnpm test`, `pnpm build`. Chi tiết event và ACK ở [WebSocket contract](../../docs/ws-events.md).
Backend Express + Socket.IO. Module Realtime tuân thủ `docs/ws-events.md`; không tạo Socket.IO server độc lập ngoài gateway chung.

Root `pnpm dev` khởi động ứng dụng. `src/index.ts` là entrypoint; `src/app.ts` là HTTP app dùng cho test. Server cần PostgreSQL/Redis và `SESSION_SECRET` tối thiểu 32 ký tự. `/api/v1/health` chỉ kiểm tra HTTP liveness. Namespace `/exam` xác thực bằng cùng Redis session với HTTP và có handler nghiệp vụ realtime.

Auth theo `core-openapi`: `/api/v1/auth/register`, `/login`, `/me`, `/logout`. Register/login/me trả `{data: User}`; đăng ký tạo STUDENT với password 8–72 ký tự, email trùng trả `EMAIL_TAKEN`. Không có bước lấy CSRF token. Xem [Auth contract](../../docs/auth-contract.md) về cookie/session, kiểm tra nguồn request, middleware cho TV2/TV3 và integration tests.

`createApp` mount session middleware một lần trước Auth và `apiRouter` nghiệp vụ tại `/api/v1`; health nằm trước middleware và vẫn công khai. Core truyền router qua `apiRouter`, dùng `req.principal` cùng `sessions.requireUser`/`requireRoles`. Lỗi HTTP dùng chung `src/core/errors/http-error.ts` và `src/core/http/error-handler.ts`; `AuthError` kế thừa lỗi chung để giữ xử lý riêng của Auth/Socket.IO.

Login đếm mọi request theo IP (30/15 phút), nhưng chỉ đếm lần sai theo tài khoản (5/15 phút). Login thành công reset counter tài khoản có điều kiện; không reset IP. Đủ ngưỡng sai thì request tiếp theo bị chặn đến hết cửa sổ, kể cả mật khẩu đúng. Đăng ký giới hạn 20 request hợp lệ về cấu trúc/IP/15 phút.

`prisma/schema.prisma` ánh xạ các bảng SQL hiện có để generate client; build/dev/typecheck tự generate. TV2 tiếp tục quản lý baseline và migration; không chạy `db push` hoặc migration/reset lên database cũ từ schema chưa baseline. CHECK và partial indexes vẫn nằm trong SQL gốc. Auth không thay đổi schema database.

# Server

Backend Express + Socket.IO. Module Realtime tuân thủ `docs/ws-events.md`; không tạo Socket.IO server độc lập ngoài gateway chung.

Root `pnpm dev` khởi động ứng dụng. `src/index.ts` là entrypoint; `src/app.ts` là HTTP app dùng cho test. Server cần PostgreSQL/Redis và `SESSION_SECRET` tối thiểu 32 ký tự. `/api/v1/health` chỉ kiểm tra HTTP liveness. Namespace `/exam` xác thực bằng cùng Redis session với HTTP; chưa có handler nghiệp vụ thi.

Auth đã có `/api/v1/auth/csrf`, `/register`, `/login`, `/me`, `/logout`. Xem [Auth contract](../../docs/auth-contract.md) để lấy CSRF token trước POST, dùng middleware cho TV2/TV3 và chạy integration tests.

`prisma/schema.prisma` ánh xạ các bảng SQL hiện có để generate client; build/dev/typecheck tự generate. TV2 tiếp tục quản lý baseline và migration; không chạy `db push` hoặc migration/reset lên database cũ từ schema chưa baseline. CHECK và partial indexes vẫn nằm trong SQL gốc. Auth không thay đổi schema database.

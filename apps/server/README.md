# Server

Backend Express + Socket.IO. Module Realtime tuân thủ `docs/ws-events.md`; không tạo Socket.IO server độc lập ngoài gateway chung.

Root `pnpm dev` khởi động ứng dụng. `src/index.ts` là entrypoint; `src/app.ts` là HTTP app dùng cho test. Server cần PostgreSQL/Redis và `SESSION_SECRET` tối thiểu 32 ký tự. `/api/v1/health` chỉ kiểm tra HTTP liveness. Namespace `/exam` xác thực bằng cùng Redis session với HTTP; chưa có handler nghiệp vụ thi.

Auth theo `core-openapi`: `/api/v1/auth/register`, `/login`, `/me`, `/logout`. Register/login/me trả `{data: User}`; đăng ký tạo STUDENT với password 8–72 ký tự, email trùng trả `EMAIL_TAKEN`. Không có bước lấy CSRF token. Xem [Auth contract](../../docs/auth-contract.md) về cookie/session, kiểm tra nguồn request, middleware cho TV2/TV3 và integration tests.

`createApp` mount session middleware một lần trước Auth và `apiRouter` nghiệp vụ tại `/api/v1`; health nằm trước middleware và vẫn công khai. Core truyền router qua `apiRouter`, dùng `req.principal` cùng `sessions.requireUser`/`requireRoles`. Lỗi HTTP dùng chung `src/core/errors/http-error.ts` và `src/core/http/error-handler.ts`; `AuthError` kế thừa lỗi chung để giữ xử lý riêng của Auth/Socket.IO.

Login đếm mọi request theo IP (30/15 phút), nhưng chỉ đếm lần sai theo tài khoản (5/15 phút). Login thành công reset counter tài khoản có điều kiện; không reset IP. Đủ ngưỡng sai thì request tiếp theo bị chặn đến hết cửa sổ, kể cả mật khẩu đúng. Đăng ký giới hạn 20 request hợp lệ về cấu trúc/IP/15 phút.

`prisma/schema.prisma` ánh xạ các bảng SQL hiện có để generate client; build/dev/typecheck tự generate. TV2 tiếp tục quản lý baseline và migration; không chạy `db push` hoặc migration/reset lên database cũ từ schema chưa baseline. CHECK và partial indexes vẫn nằm trong SQL gốc. Auth không thay đổi schema database.

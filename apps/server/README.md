# Server

Backend Express + Socket.IO. Module Realtime tuân thủ `docs/ws-events.md`; không tạo Socket.IO server độc lập ngoài gateway chung.

Root `pnpm dev` khởi động ứng dụng. `src/index.ts` là entrypoint; `src/app.ts` là HTTP app dùng cho test. `/api/v1/health` chỉ kiểm tra HTTP liveness. Namespace `/exam` đóng mặc định đến khi TV1/TV3 triển khai xác thực session Redis. Chưa có API Auth/nghiệp vụ.

Prisma dependencies đã chuẩn bị. TV2 tạo `prisma/schema.prisma` và baseline SQL hiện tại trước khi dùng `db:generate`/`db:validate`; không chạy migration tự động lên database cũ.

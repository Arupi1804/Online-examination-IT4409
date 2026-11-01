# Server

Backend Express + Socket.IO. Module Realtime tuân thủ `docs/ws-events.md`; không tạo Socket.IO server độc lập ngoài gateway chung.

Root `pnpm dev` khởi động ứng dụng. `src/index.ts` là entrypoint; `src/app.ts` là HTTP app dùng cho test. `/api/v1/health` chỉ kiểm tra HTTP liveness. Namespace `/exam` đóng mặc định đến khi TV1/TV3 triển khai xác thực session Redis. Chưa có API Auth/nghiệp vụ.

Biến môi trường được nạp trong `src/config/env.ts`; module nào đọc env lúc import (như `src/core/prisma.ts`) phải import file này trước. Test API trong `tests/integration` dùng PostgreSQL thật (`pnpm infra:up`) và tự bỏ qua khi không có `DATABASE_URL`.

`prisma/schema.prisma` phản chiếu `database/init/*.sql` (xem `database/README.md`); không dùng Prisma Migrate. Prisma CLI không tự đọc `.env` ở root, nên gọi qua script `prisma` của package này:

```powershell
pnpm --filter @online-exam/server db:generate   # sinh Prisma Client sau khi sửa schema
pnpm --filter @online-exam/server db:validate
pnpm --filter @online-exam/server db:diff       # so schema.prisma với DB đang chạy
pnpm --filter @online-exam/server prisma studio # xem dữ liệu
```

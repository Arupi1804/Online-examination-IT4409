# Kiểm tra workspace

Đã kiểm tra trên Windows với Node 20.19.5 và pnpm 10.11.0:

- Cài đặt offline với `--frozen-lockfile`: thành công, không cần đổi lockfile.
- `pnpm check`: lint, Prettier, TypeScript, 5 test Vitest/Supertest và build ba package thành công.
- Playwright Chromium: client gọi `/api/v1/health` qua Vite proxy thành công.
- `docker compose config --quiet`: cấu hình hợp lệ.
- SQL khởi tạo database không thay đổi.

Chưa kiểm chứng container build/run vì Docker Engine trên máy chưa chạy. CI GitHub Actions đã được tạo nhưng chưa chạy trên GitHub trong phiên này. Nginx local chưa có TLS.

TV1 cần điền GitHub handle trong CODEOWNERS và cấu hình branch protection. TV2 tiếp tục Prisma model/baseline/OpenAPI; TV3 tiếp tục session-authenticated gateway và payload event. Không coi các dependency đã cài là chức năng nghiệp vụ đã triển khai.

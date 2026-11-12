# Frontend Online Examination

React 18, Vite 6, TypeScript 5.8, Tailwind CSS 3 và pnpm 10.11.
Chạy lệnh tại `apps/client` với Node 20.19.5.

```powershell
pnpm.cmd install
pnpm.cmd build
pnpm.cmd dev
```

Mở `http://localhost:5173/login`.

Frontend gọi API Auth tại `/api/v1/auth/*` với cookie session. Cấu hình
`VITE_API_URL` để trỏ tới backend chạy riêng, hoặc dùng Vite proxy cổng 3000.
Request/response và validation được đối chiếu với `docs/openapi.yaml` trên
nhánh `dev` đã merge và kiểm chứng.
Đăng ký gửi email, mật khẩu, họ tên và tạo tài khoản thí sinh.

Để thử UI riêng, đặt `VITE_USE_MOCK=true` trong `apps/client/.env.local` rồi
khởi động lại Vite. Tài khoản mock là `student1@test.com`, mật khẩu `Test@1234`.
Tài khoản vừa đăng ký trong mock tồn tại đến khi tải lại trang.

```powershell
pnpm.cmd check
pnpm.cmd test:e2e
```

Các E2E test dùng HTTP response fixtures của frontend theo contract Auth.
Để dùng Edge đã cài, đặt `PLAYWRIGHT_CHANNEL=msedge` khi chạy E2E.

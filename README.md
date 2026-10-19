# Online Examination

Dự án bài tập lớn môn Công nghệ Web và Dịch vụ trực tuyến (IT4409): nền tảng thi trực tuyến có ba vai trò Admin, Giáo viên và Thí sinh.

Khung này tổ chức theo monorepo để frontend, backend nghiệp vụ và backend realtime phát triển song song.

## Cấu trúc chính

```text
apps/client/        React + Vite: giao diện giáo viên và thí sinh
apps/server/        Express + Socket.IO: REST API và realtime gateway
packages/shared/    Kiểu dữ liệu, hằng số event và schema dùng chung
database/           Migration, seed và ERD
docs/               Contract API/WebSocket và tài liệu kiến trúc
infra/              Hạ tầng phát triển/triển khai (Nginx)
```

## Khởi động hạ tầng cục bộ

1. Sao chép `.env.example` thành `.env` và thay giá trị phù hợp.
2. Chạy `docker compose up -d` để khởi động PostgreSQL và Redis.
3. Mỗi ứng dụng sẽ bổ sung `package.json` và hướng dẫn chạy riêng khi thành viên phụ trách bắt đầu triển khai.

## Quy ước phối hợp

- Không đẩy trực tiếp vào `main`; làm việc trên `feature/*` và mở pull request.
- Mọi thay đổi REST API cập nhật `docs/api-contract.md`.
- Mọi thay đổi Socket.IO cập nhật `docs/ws-events.md` và hằng số/schema tương ứng trong `packages/shared`.
- Server là nguồn thời gian duy nhất của kỳ thi; không đưa đáp án đúng xuống client.

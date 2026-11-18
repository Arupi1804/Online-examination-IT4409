# Tài liệu dự án

- `auth-contract.md`: API Auth, bảo vệ nguồn request, rate limit, session/single-session, middleware HTTP/Socket và kiểm thử tích hợp.

- `CONTRACT.md`: stack, phân công và quy tắc giao tiếp chung theo PDF.
- `openapi.yaml`: REST contract cho health, Auth, questions, exams, attempts và kết quả/thống kê/import/export. Có contract không đồng nghĩa mọi endpoint đã được triển khai; xem source và PR tương ứng.

- `architecture.md`: quyết định kiến trúc.
- `api-contract.md`: REST API được thống nhất.
- `ws-events.md`: contract Socket.IO.
- `redis-key-schema.md`: key, dữ liệu, TTL và vòng đời của session, timer, presence, rate limit và job.
- `adr/`: Architecture Decision Records.
- `testing/`: kế hoạch và báo cáo kiểm thử.

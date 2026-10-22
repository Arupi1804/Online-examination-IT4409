# Contract chung

## Stack và workspace

- Node 20.19.5, pnpm 10.11.0, TypeScript strict, ESM.
- React 18, Vite, React Router, TanStack Query, Tailwind tại `apps/client`.
- Express, Socket.IO 4 tại `apps/server`; chỉ một HTTP server và gateway chung.
- PostgreSQL 16, Prisma 6, Redis 7. TV2 quản lý schema và migration.
- Zod/type/event/error dùng chung tại `packages/shared`, liên kết bằng `workspace:*`.
- Vitest + Supertest; Playwright cho E2E.
- Phiên bản chính xác nằm trong manifests và lockfile; thay đổi qua PR.

Giữ các module nghiệp vụ riêng `questions`, `exams`, `attempts`, `results` thay cho một thư mục `exam` lớn. Frontend giữ `features/teacher`, `features/student`, `components` thay cho đường dẫn minh họa trong PDF. Trách nhiệm không thay đổi. 

## Dữ liệu và giao tiếp

- JSON camelCase; DB snake_case; Prisma map trường khi TV2 triển khai.
- UUID v4; thời gian ISO 8601 UTC; thời lượng giây; điểm làm tròn hai chữ số.
- Mã phòng sáu ký tự theo `^[A-HJ-NP-Z2-9]{6}$`. Ví dụ hợp lệ `K7M2QX`;Không hợp lệ `DEMO01`.
- REST `/api/v1`; cookie session httpOnly; client gửi `credentials: 'include'`.
- Thành công `{ data, meta? }`; lỗi `{ error: { code, message, details? } }`; danh sách dùng `page`, `pageSize`, `total`.
- HTTP: 200/201/204, 400/401/403/404/409/422/429; lỗi nội bộ 500 không lộ thông tin.
- Namespace Socket.IO `/exam`; xác thực cùng session Redis; room `exam:<examId>`, `monitor:<examId>`, `user:<userId>`.
- ACK client event: `{ ok: true, data }` hoặc `{ ok: false, error: { code, message } }`.
- Server quyết định thời gian, điểm, quyền và trạng thái. Không gửi `isCorrect` cho thí sinh đang thi.
- Exam: DRAFT → SCHEDULED → RUNNING → ENDED. Attempt: IN_PROGRESS → SUBMITTED / AUTO_SUBMITTED / FORCE_SUBMITTED.
- Timer/presence/job theo `redis-key-schema.md`; PostgreSQL lưu `end_time` bền vững. Không lưu bài làm chỉ trong Redis.

## Phân công và review

| Thành viên | Sở hữu                                                           |
| ---------- | ---------------------------------------------------------------- |
| TV1        | Workspace, Auth, security, CI, Docker, duyệt shared/docs         |
| TV2        | Questions/exams/attempts/results, Prisma, OpenAPI, import/export |
| TV3        | Gateway, event schemas, timer, rejoin, monitoring và mock Socket |
| TV4        | Giao diện giáo viên                                              |
| TV5        | Giao diện thí sinh, UI chung, QA                                 |

Nhánh `main`, `dev`, `feature/<role>-<mo-ta>`; không push trực tiếp main/dev. Conventional Commits, PR ít nhất một người duyệt. Thay đổi contract cần TV1 và một người bị ảnh hưởng duyệt trước khi triển khai. Thay đổi phá tương thích chỉ merge đầu tuần và thông báo nhóm. Cập nhật mock cùng contract.

CODEOWNERS hiện là mẫu: thay handle thật và bật branch protection trên GitHub để thực thi review. Các thiết lập remote chưa được tự động thay đổi.

## Phần tiếp tục bàn giao

- TV1: Auth/session Redis, single-session, CSRF/rate limit, HTTPS staging.
- TV2: hoàn thiện OpenAPI cho endpoint PDF, Prisma baseline từ SQL hiện có, seed và API nghiệp vụ. Chưa chạy Prisma migration lên DB có sẵn.
- TV3: điền payload/ACK/quyền của từng event, mock và logic realtime. Gateway hiện từ chối handshake để không mở kết nối chưa xác thực.
- TV4/TV5: UI, mock API, route và E2E nghiệp vụ; không tạo type/event trùng shared.

Definition of Done: lint/type-check/test/build thành công, chạy được bằng Compose, đúng contract, cập nhật tài liệu và có review. z
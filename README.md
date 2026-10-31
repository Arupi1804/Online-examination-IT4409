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

Cách này dùng để phát triển: PostgreSQL/Redis chạy bằng Docker, client/server/shared chạy trên máy và tự cập nhật khi sửa source. Nếu muốn chạy toàn bộ bằng Docker mà không cài Node/pnpm trên máy, xem mục **Docker** bên dưới.

Thực hiện các lệnh tại thư mục gốc repo. Cần Docker Desktop đang chạy với Linux containers, Node **20.19.5** và pnpm **10.11.0**. Chọn Node bằng công cụ quản lý phiên bản trên máy; `.nvmrc` và `.node-version` chỉ ghi phiên bản, không tự chuyển Node.

1. Kiểm tra môi trường; cài pnpm nếu chưa có đúng phiên bản:

   ```powershell
   node --version
   npm install --global pnpm@10.11.0
   pnpm --version
   docker version
   ```

   `docker version` cần hiển thị cả Client và Server.

2. Mỗi thành viên tạo `.env` riêng nếu chưa có, rồi chỉnh giá trị phù hợp:

   ```powershell
   if (!(Test-Path .env)) {
       Copy-Item .env.example .env
   }
   ```

   Giữ `.env` đã có khi pull code; đối chiếu `.env.example` để bổ sung biến mới. `DATABASE_URL` phải khớp `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` và `POSTGRES_PORT`; server chạy trên máy nên dùng host `localhost`. `REDIS_URL` cũng dùng `localhost` và cổng Redis đã cấu hình. Thay `SESSION_SECRET` bằng giá trị riêng và không commit `.env`.

3. Cài dependencies theo lockfile, dừng client/server Docker nếu từng chạy để tránh trùng cổng, rồi khởi động hạ tầng và source:

   ```powershell
   pnpm install --frozen-lockfile
   docker compose stop client server
   pnpm infra:up
   pnpm dev
   ```

   `pnpm dev` build shared trước, sau đó watch shared, server và client. Sau khi pull code có thay đổi dependencies, chạy lại `pnpm install --frozen-lockfile`.

4. Mở http://localhost:5173, kiểm tra trang hiển thị `API: ok`. API trực tiếp tại http://localhost:3000/api/v1/health. Các địa chỉ này dùng cổng mặc định; nếu đổi `SERVER_PORT`, cập nhật proxy trong `apps/client/vite.config.ts` tương ứng.

Nhấn `Ctrl+C` để dừng source; chạy `pnpm infra:stop` để dừng PostgreSQL/Redis và giữ dữ liệu. Health API chỉ kiểm tra HTTP server, chưa xác nhận kết nối database/Redis.

## Quy ước phối hợp

- Không đẩy trực tiếp vào `main`; làm việc trên `feature/*` và mở pull request.
- Mọi thay đổi REST API cập nhật `docs/api-contract.md`.
- Mọi thay đổi Socket.IO cập nhật `docs/ws-events.md` và hằng số/schema tương ứng trong `packages/shared`.
- Server là nguồn thời gian duy nhất của kỳ thi; không đưa đáp án đúng xuống client.

## Docker

Chạy toàn bộ client/server/PostgreSQL/Redis trong container. Máy chỉ cần Docker Desktop và Docker Compose; không cần cài Node/pnpm local. Tạo `.env` theo hướng dẫn trên nếu chưa có. Compose tự đặt host `postgres` và `redis` cho kết nối từ server container.

Dừng `pnpm dev` nếu đang chạy để tránh trùng cổng. Tại root:

```powershell
docker compose config --quiet
docker compose up --build -d --wait
docker compose ps
```

Mở http://localhost:5173 và kiểm tra `API: ok`. `postgres`, `redis`, `server` cần ở trạng thái healthy; `client` cần running và hiện chưa có healthcheck riêng. Xem log hoặc dừng container bằng:

```powershell
docker compose logs -f server client
docker compose stop
```

`Ctrl+C` khi theo dõi log chỉ dừng theo dõi, không dừng container. Nếu image đã có và source không thay đổi, dùng `docker compose up -d --wait`. Sau khi pull hoặc sửa source, chạy lại `docker compose up --build -d --wait` để cập nhật image: cấu hình Docker hiện tại không tự đồng bộ source như `pnpm dev`.

Nginx phục vụ client tại 5173 và proxy API/WebSocket. Đây là local HTTP; HTTPS staging/production do TV1 cấu hình sau. Không dùng `down -v` nếu cần giữ dữ liệu. SQL init chỉ chạy trên volume mới; đổi `POSTGRES_PASSWORD` trong `.env` không tự đổi mật khẩu database đã tồn tại.

## Lệnh chung

| Lệnh                                | Công dụng                               |
| ----------------------------------- | --------------------------------------- |
| `pnpm dev`                          | Watch shared, server và client          |
| `pnpm build`                        | Build theo dependency                   |
| `pnpm typecheck`                    | Build shared rồi kiểm tra kiểu          |
| `pnpm lint`                         | ESLint                                  |
| `pnpm format` / `pnpm format:check` | Sửa / kiểm tra định dạng                |
| `pnpm test`                         | Vitest + Supertest                      |
| `pnpm test:e2e`                     | Playwright; tự khởi động dev server     |
| `pnpm check`                        | Lint, format, type-check, test và build |
| `pnpm infra:up` / `pnpm infra:stop` | Chạy / dừng PostgreSQL và Redis         |

Trước E2E lần đầu: `pnpm exec playwright install chromium`. CI cài browser và chạy E2E.

Thêm dependency vào đúng package bằng `pnpm --filter @online-exam/server add <package>`; công cụ chung dùng `pnpm add -Dw <package>`. Chỉ commit lockfile root; không commit `.env`, `dist`, `node_modules`.

## Bàn giao

Đọc [contract chung](docs/CONTRACT.md), [REST](docs/api-contract.md), [WS](docs/ws-events.md), [Redis](docs/redis-key-schema.md). Dùng feature branch, Conventional Commits và PR review. Điền handle thật trong CODEOWNERS rồi bật branch protection trên GitHub.

Chưa có Auth, nghiệp vụ thi, seed hoặc mock. Prisma dependencies đã có; TV2 tạo `apps/server/prisma/schema.prisma`, baseline SQL hiện tại rồi mới dùng `db:generate`/`db:validate`. Không tự chạy migration lên database cũ. DATABASE*URL local phải khớp POSTGRES*\*; mật khẩu đặc biệt phải URL-encode trong URL.
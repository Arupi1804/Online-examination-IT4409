# Kiểm tra Auth/session

Nhánh triển khai: `feature/Auth`, tạo từ `dev`.

## Đã xác nhận

- Node 20.19.5, pnpm 10.11.0.
- Sau khi merge `dev` và khôi phục export Auth trong shared: `pnpm check` thành công với lint, Prettier, TypeScript, 20 test và build client/server/shared.
- `docs/openapi.yaml` và `docs/api-contract.md` đã đồng bộ quy tắc từ `dev`: chỉ sửa kỳ thi DRAFT, publish đề rỗng trả 422 `VALIDATION_FAILED`.
- E2E Chromium chạy với `CI=true`: 1/1 test thành công. Playwright chờ `/api/v1/health` qua proxy Vite trước khi chạy test.
- Integration dùng Redis/PostgreSQL thật: đăng ký trực tiếp không cần token, response `{data: User}`, password 8–72 ký tự (gồm Unicode), lỗi `EMAIL_TAKEN`, login/logout, rate limit, single-session và Prisma mapping.
- Kiểm tra nguồn request thay cho CSRF token: từ chối Origin/Referer khác nguồn, Fetch Metadata cross-site và form login; client JSON không cần header tự đặt. Cookie vẫn httpOnly và SameSite=Lax.
- Session cũ không thể lưu lại hoặc xóa pointer của session mới.
- Socket dùng cookie đã ký, bị từ chối khi thiếu/sai/hết phiên; bị ngắt khi login mới, logout hoặc idle expiry.
- Socket không gia hạn Redis TTL; HTTP gia hạn cookie, session và pointer cùng nhau.
- Test Redis dùng prefix UUID riêng; Prisma test tạo rồi xóa đúng email UUID riêng. Không reset/flush database, không sửa SQL/schema đang chạy.

## Giới hạn kiểm chứng

Docker image chưa được chạy lại sau khi đồng bộ `dev` và sửa export Auth:

- Docker build đã compile thành công cả ba package trên Linux, nhưng bước export/unpack image thất bại với lỗi `parent snapshot ... does not exist`. Chưa xác nhận image chạy hoàn chỉnh; không xóa Docker cache/volume để xử lý lỗi máy.
- GitHub Actions đã bổ sung service PostgreSQL/Redis, SQL init và biến test; chưa chạy workflow trên remote.

Xem `docs/auth-contract.md` để chạy lại integration tests và cách bàn giao middleware cho TV2/TV3. Không dùng database production cho test.

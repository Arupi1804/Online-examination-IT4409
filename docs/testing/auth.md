# Kiểm tra Auth/session

Nhánh triển khai: `feature/Auth`, tạo từ `dev`.

## Đã xác nhận

- Node 20.19.5, pnpm 10.11.0.
- Đợt xử lý review PR #6 ngày 11/11/2026: `pnpm check` thành công với lint, Prettier, TypeScript, 32 test và build client/server/shared.
- `docs/openapi.yaml` và `docs/api-contract.md` đã đồng bộ quy tắc từ `dev`: chỉ sửa kỳ thi DRAFT, publish đề rỗng trả 422 `VALIDATION_FAILED`.
- E2E Chromium chạy với `CI=true`: 3/3 test thành công, gồm health qua proxy, browser POST login JSON đúng Origin nhận lỗi credentials 401 và browser POST từ 127.0.0.1 khác Origin bị 403. Không tạo tài khoản E2E. Playwright dùng localhost, đặt `CLIENT_ORIGIN` tương ứng và chờ `/api/v1/health` qua proxy Vite trước khi chạy test.
- Integration dùng Redis/PostgreSQL thật: đăng ký trực tiếp không cần token, response `{data: User}`, password 8–72 ký tự (gồm Unicode), lỗi `EMAIL_TAKEN`, login/logout, rate limit, single-session và Prisma mapping.
- Kiểm tra nguồn request thay cho CSRF token: từ chối Origin/Referer khác nguồn, Fetch Metadata cross-site và form login; client JSON không cần header tự đặt. Cookie vẫn httpOnly và SameSite=Lax.
- Login đúng liên tiếp hơn 5 lần không tiêu thụ counter sai của tài khoản. Sai 5 lần thì request tiếp theo bị 429 trước xác minh, kể cả mật khẩu đúng. Thành công reset counter tài khoản nếu snapshot vẫn khớp; counter IP vẫn đếm mọi request và chặn request thứ 31.
- Request sai đồng thời không mất increment hoặc TTL. Login đang xác minh không xóa lỗi sai vừa được ghi hoặc bộ đếm của cửa sổ mới. Request bị chặn không gia hạn cửa sổ tài khoản.
- Router nghiệp vụ dùng chung `req.principal`, kiểm tra role và Origin; một request chỉ chạy bước save session một lần. Health không chạy xác thực/gia hạn ngay cả khi cookie đã bị thu hồi. Hai route login/register vẫn yêu cầu JSON sau khi chuyển điểm mount middleware.
- `HttpError` của Core và `AuthError` dùng chung envelope; giữ `details`, `Retry-After`, xử lý Zod/JSON và che lỗi nội bộ. Auth/Socket.IO vẫn dùng `instanceof AuthError` để xử lý phiên.
- Session cũ không thể lưu lại hoặc xóa pointer của session mới.
- Socket dùng cookie đã ký, bị từ chối khi thiếu/sai/hết phiên; bị ngắt khi login mới, logout hoặc idle expiry.
- Socket không gia hạn Redis TTL; HTTP gia hạn cookie, session và pointer cùng nhau.
- Test Redis dùng prefix UUID riêng; Prisma test tạo rồi xóa đúng email UUID riêng. Không reset/flush database, không sửa SQL/schema đang chạy.

## Giới hạn kiểm chứng

Không chạy lại Docker image trong đợt xử lý review này:

- Lần kiểm tra trước trên máy đã compile cả ba package trên Linux nhưng lỗi export/unpack snapshot. Sau đó Doson-062 báo cáo Docker build/run và Auth flow thành công trên PR #6; đó là bằng chứng của reviewer cho commit trước đợt sửa này, không phải lần chạy Docker mới ở đây.
- GitHub Actions có service PostgreSQL/Redis, SQL init và biến test riêng; xem checks trên PR #6 để đối chiếu kết quả remote của đúng commit. Không suy ra kết quả CI từ các lần chạy local.

Xem `docs/auth-contract.md` để chạy lại integration tests và cách bàn giao middleware cho TV2/TV3. Không dùng database production cho test.

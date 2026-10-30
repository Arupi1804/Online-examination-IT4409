# Kiểm tra Auth/session

Nhánh triển khai: `feature/Auth`, tạo từ `dev`.

## Đã xác nhận

- Node 20.19.5, pnpm 10.11.0.
- `pnpm check` thành công: lint, Prettier, TypeScript, 17 test, build client/server/shared.
- Integration dùng Redis/PostgreSQL đang chạy: cookie/CSRF, đăng ký STUDENT, bcrypt, login/logout, rate limit, single-session và Prisma mapping.
- Session cũ không thể lưu lại hoặc xóa pointer của session mới.
- Socket dùng cookie đã ký, bị từ chối khi thiếu/sai/hết phiên; bị ngắt khi login mới, logout hoặc idle expiry.
- Socket không gia hạn Redis TTL; HTTP gia hạn cookie, session và pointer cùng nhau.
- Test Redis dùng prefix UUID riêng; Prisma test tạo rồi xóa đúng email UUID riêng. Không reset/flush database, không sửa SQL/schema đang chạy.

## Chưa xác nhận hoàn toàn

- E2E client/API lần đầu thất bại do Vite sẵn sàng trước Prisma/Auth; test đã thêm bước poll health qua proxy trước khi mở trang. Lần chạy lại chưa được cho phép nên chưa xác nhận bản sửa E2E này.
- Docker build đã compile thành công cả ba package trên Linux, nhưng bước export/unpack image thất bại với lỗi `parent snapshot ... does not exist`. Chưa xác nhận image chạy hoàn chỉnh; không xóa Docker cache/volume để xử lý lỗi máy.
- GitHub Actions đã bổ sung service PostgreSQL/Redis, SQL init và biến test; chưa chạy workflow trên remote.

Xem `docs/auth-contract.md` để chạy lại integration tests và cách bàn giao middleware cho TV2/TV3. Không dùng database production cho test.

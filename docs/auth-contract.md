# Auth theo contract core-openapi

`docs/openapi.yaml` và `docs/api-contract.md` được lấy nguyên nội dung từ nhánh `feature/core-openapi`. Đây là nguồn chuẩn cho API; tài liệu này giải thích triển khai Auth/session của TV1. Client/server dùng schema tại `packages/shared/src/auth.ts`.

## Luồng frontend

1. Gửi trực tiếp `POST /api/v1/auth/register` với JSON `{email,password,name}`. Response 201 là `{data: User}`. Tài khoản luôn là STUDENT và chưa đăng nhập.
2. Gửi trực tiếp `POST /api/v1/auth/login` với JSON `{email,password}` và `credentials: 'include'`. Response 200 là `{data: User}`; browser giữ cookie session httpOnly.
3. Gọi `GET /api/v1/auth/me` với `credentials: 'include'` khi tải lại trang. Response 200 là `{data: User}`, 401 thì yêu cầu đăng nhập lại.
4. Gửi `POST /api/v1/auth/logout` với `credentials: 'include'`; không cần body. Thành công trả 204 và xóa cookie.

Không có bước `/auth/csrf`, không có `csrfToken` trong response và không cần header tự đặt. `User = {id,email,name,role}` nằm trực tiếp trong `data`, không có lớp `data.user`. Response Auth dùng `Cache-Control: no-store`, không trả password hash/session ID/secret.

## Input và mã lỗi

- Đăng ký: email đúng định dạng, tối đa 254 ký tự; password 8–72 ký tự Unicode; name 1–100 ký tự. Thuộc tính ngoài schema được bỏ qua, kể cả `role`; server luôn cấp STUDENT.
- LoginInput yêu cầu email đúng định dạng và password là string, không tự thêm minLength/maxLength ngoài OpenAPI. Password sai (kể cả chuỗi rỗng) trả 401 `AUTH_INVALID_CREDENTIALS` thay vì lỗi validation. Email được lưu/tra cứu lowercase; không trim hoặc đổi chữ password.
- Register 400 `VALIDATION_FAILED`, 409 `EMAIL_TAKEN`, 429 `RATE_LIMITED`. Login 400 `VALIDATION_FAILED`, 401 `AUTH_INVALID_CREDENTIALS`, 429 `RATE_LIMITED`.
- `/auth/me` và `/auth/logout` trả 401 `AUTH_SESSION_EXPIRED` hoặc `AUTH_SESSION_REPLACED` khi phiên không hợp lệ.
- Login sai email/password dùng cùng mã lỗi. Giới hạn IP: 30 request đăng nhập/15 phút, tính cả đúng và sai, kiểm tra trước DB/bcrypt; login thành công không reset counter IP.
- Giới hạn tài khoản: 5 lần đăng nhập sai trong cửa sổ 15 phút từ lần sai đầu tiên. Khi đủ 5 lần sai, request tiếp theo trả 429 trước DB/bcrypt, kể cả mật khẩu đúng, đến khi cửa sổ hết hạn. Request bị chặn không kéo dài TTL. Login thành công trước ngưỡng xóa counter sai nếu giá trị/cửa sổ không thay đổi trong lúc xác minh; không xóa lỗi sai đồng thời hoặc counter thuộc cửa sổ mới.
- Đăng ký giới hạn 20 request hợp lệ về cấu trúc/IP/15 phút, tính cả email trùng. Redis key chứa digest HMAC thay cho email/IP. 429 có `Retry-After: 900` (giới hạn trên của thời gian chờ).

## Bảo vệ request và mật khẩu

Client browser gửi JSON và `credentials: 'include'`; Origin được browser tự đặt. Server từ chối nguồn Origin/Referer khác `CLIENT_ORIGIN`, Fetch Metadata báo cross-site hoặc có Fetch Metadata nhưng không xác định được nguồn. Login/register không nhận form/text payload; yêu cầu `Content-Type: application/json`. Cookie giữ SameSite=Lax. Vi phạm nguồn request bị từ chối với 403 `FORBIDDEN`; không dùng mã CSRF_INVALID hoặc yêu cầu token ngoài contract. Native API clients có thể không gửi Origin/Referer/Fetch Metadata.

`http://localhost:5173` và `http://127.0.0.1:5173` là hai Origin khác nhau. Local mặc định dùng localhost như `.env.example`; frontend phải mở đúng Origin được cấu hình. Playwright dùng localhost và đặt `CLIENT_ORIGIN=http://localhost:5173` cho dev server do nó khởi động. Nếu tái sử dụng dev server đã chạy sẵn, cấu hình của server đó cũng phải khớp. Không bỏ kiểm tra Origin hoặc mở wildcard để giải quyết sai cấu hình.

Mật khẩu thông thường tiếp tục dùng bcrypt cost 12, tương thích hash đã có và seed bcrypt của TV2. OpenAPI giới hạn ký tự, không giới hạn UTF-8 bytes: password Unicode hợp lệ dài hơn 72 bytes được SHA-256/base64 trước bcrypt và lưu với prefix `bcrypt-sha256$`. Verify phân biệt prefix để không cắt mất đuôi Unicode; hash bcrypt cũ vẫn đăng nhập bình thường. Không thay đổi schema DB, không rehash hàng loạt tài khoản.

## Session và single-session

- Cookie `connect.sid`, signed bằng `SESSION_SECRET` tối thiểu 32 ký tự; httpOnly, sameSite=lax, path=/, không đặt Domain.
- Idle TTL 28.800 giây (8 giờ). HTTP hợp lệ đi qua session middleware gia hạn cookie, session và active pointer. Health công khai không chạy middleware này và không gia hạn phiên. Socket handshake/event không gia hạn cookie hoặc Redis TTL.
- Local HTTP: `APP_ENV=dev`, `COOKIE_SECURE=false`. Staging/prod bắt buộc HTTPS và `COOKIE_SECURE=true`. `TRUST_PROXY_HOPS=1` chỉ khi đứng sau đúng một proxy tin cậy; mặc định 0. Không tin X-Forwarded-For từ client tùy ý.
- Prefix `P=oe:<APP_ENV>:v1`. Session `P:sess:<sid>` có `cookie`, `userId`, `role`; các trường Auth ở cấp cao nhất để TV3 đọc.
- Pointer `P:auth:user:<userId>:active_session` chứa sid hợp lệ. Lua tạo session mới và thay pointer nguyên tử, xóa session cũ; chỉ chấp nhận session trùng pointer.
- Save/renew chỉ thực hiện khi sid vẫn active và session còn tồn tại. Lua đồng bộ hạn session/pointer; request cũ không thể phục hồi hoặc gia hạn phiên bị thay thế.
- Destroy chỉ xóa pointer nếu nó vẫn trỏ đến chính sid bị hủy. Logout/cleanup của phiên cũ không xóa phiên mới.
- Sau khi session cũ đã bị xóa, request từ cookie cũ có thể nhận `AUTH_SESSION_EXPIRED`; khi session vẫn còn nhưng pointer đã đổi, nhận `AUTH_SESSION_REPLACED`. Frontend xử lý cả hai như yêu cầu đăng nhập lại.
- Mất Redis: từ chối xác thực; không fallback sang MemoryStore. Sau khi Redis mất dữ liệu phải đăng nhập lại. Bài làm/kết quả không thuộc session.

## Bàn giao cho TV2

Auth xuất `AuthSessions` và `AuthRepository`. Bootstrap dùng `PrismaAuthRepository`; model ánh xạ SQL hiện có trong `apps/server/prisma/schema.prisma`. `prisma generate` không thay đổi database. Không chạy `db push`, `migrate dev`, `migrate reset` từ schema này trước khi TV2 baseline đầy đủ: SQL còn có CHECK và partial indexes Prisma không biểu diễn trong schema.

`createApp` nhận `sessionMiddleware`, `authRouter` và `apiRouter` (router nghiệp vụ tùy chọn). Bootstrap truyền `sessions.sessionMiddleware` để mount đúng một lần tại `/api/v1`, trước Auth và router nghiệp vụ; Auth router không tự mount session nữa. Khi truyền router mà thiếu session middleware, bootstrap báo lỗi thay vì chạy route chưa được bảo vệ. `/api/v1/health` được đăng ký trước session middleware nên vẫn công khai, kể cả cookie bị thu hồi.

TV2 gắn `sessions.requireUser` hoặc `sessions.requireRoles('TEACHER')` tại route bên trong `apiRouter`. Shared middleware kiểm tra Origin/Referer và Fetch Metadata trên method thay đổi dữ liệu; không yêu cầu CSRF token header. `req.principal = {id,userId,role,sid}`; role check không thay thế kiểm tra chủ sở hữu exam/attempt ở service. Login/register tự kiểm tra JSON ở route nên không phụ thuộc `req.path` của điểm mount chung.

Lỗi nghiệp vụ dùng `HttpError` tại `src/core/errors/http-error.ts`, đi qua `handleError` chung tại `src/core/http/error-handler.ts`; async Express 4 handler dùng `handle`. `AuthError` kế thừa `HttpError`, giữ các kiểm tra riêng của session/Socket.IO. Envelope, Zod/JSON validation, thông tin `details`, bảo vệ lỗi nội bộ và `Retry-After` của Auth vẫn được giữ. Không tạo thêm error handler hoặc loại lỗi HTTP trùng trong module Core.

## Bàn giao cho TV3

Chỉ tạo một Socket.IO Server trên HTTP server chung. Bootstrap của nhánh Auth đã tạo namespace `/exam` và gắn Auth; TV3 bổ sung handler vào namespace này khi tích hợp, không tạo Server thứ hai hoặc đăng ký event vào `/`.

- `sessions.sessionStore`: cùng instance Redis store với HTTP.
- `sessions.socketSessionMiddleware`: đọc cookie đã ký/session ở Engine.IO handshake, không ghi cookie/TTL. Khác HTTP middleware ở hành vi gia hạn; cùng secret/store/identity.
- `sessions.attachSocketAuthentication(namespace)`: gắn middleware namespace và kiểm tra lại trước mỗi incoming event; principal nằm tại `socket.data.principal`.
- `sessions.getPrincipal(sid)`: kiểm tra session tồn tại/chưa hết hạn, role và active pointer. Không dùng userId/role do client gửi.
- Browser handshake phải có Origin trùng `CLIENT_ORIGIN`; client không phải trình duyệt có thể không gửi Origin nhưng vẫn phải có cookie hợp lệ.
- Login mới phát `session:replaced` payload `{}` rồi ngắt socket phiên cũ; logout ngắt socket; timer kiểm tra hạn session kể cả khi socket không gửi event. HTTP renewal được timer đọc lại. Không phát event hết giờ dựa trên thời gian client.
- Chỉ user room `user:<userId>` được join tự động; room exam/monitor do TV3 kiểm tra quyền trước khi join.
- Hiện tích hợp cho một server instance, đúng phạm vi đồ án. Khi scale nhiều instance cần cơ chế thu hồi socket liên instance/adapter; chưa có broadcast thu hồi giữa các process.

Role thay đổi hoặc account bị khóa/xóa phải có luồng chủ động thu hồi session khi triển khai quản trị. `/auth/me` hiện kiểm tra account tồn tại và role không đổi; Auth chưa triển khai quản trị tài khoản.

## Kiểm thử

`pnpm test` chạy unit và health tests; integration Auth tự skip nếu chưa đặt URL test. Để kiểm thử Redis/PostgreSQL thật (PowerShell):

```powershell
$env:AUTH_REDIS_URL = 'redis://localhost:6379/0'
# Dùng database dành cho dev/test; không dùng production.
$env:AUTH_DATABASE_URL = '<PostgreSQL URL của database đã có schema SQL>'
pnpm test
Remove-Item Env:AUTH_REDIS_URL
Remove-Item Env:AUTH_DATABASE_URL
```

Redis tests dùng prefix UUID riêng và chỉ xóa key trong prefix đó. Prisma test tạo email UUID riêng, xóa đúng tài khoản đó khi kết thúc. Không reset/flush database. CI chuẩn bị PostgreSQL/Redis riêng và chạy cả integration tests.

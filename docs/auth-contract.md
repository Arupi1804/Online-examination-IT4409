# Auth contract và session v1

TV1 sở hữu Auth. Client/server cùng import schema trong `@online-exam/shared`. Base URL `/api/v1`; response thành công `{ data }`, lỗi `{ error: { code, message, details? } }`. Auth response có `Cache-Control: no-store`. Không trả password hash, session ID hoặc secret.

## Luồng frontend

1. Gọi `GET /auth/csrf` với `credentials: 'include'` để lấy cookie anonymous và `data.csrfToken`.
2. Mọi POST Auth gửi JSON, `credentials: 'include'`, header `X-CSRF-Token`. Trình duyệt tự gửi `Origin`; server yêu cầu Origin trùng chính xác `CLIENT_ORIGIN`. Khi test bằng Postman/curl phải tự gửi Origin này.
3. `POST /auth/register` tạo STUDENT nhưng không tự đăng nhập. Public API không nhận trường `role`; TEACHER/ADMIN do luồng quản trị hoặc seed cấp.
4. `POST /auth/login` tạo session ID mới, đổi CSRF token, vô hiệu session cũ. Dùng token mới từ response cho POST tiếp theo.
5. `GET /auth/me` lấy user/token khi reload trang. 401 thì quay về đăng nhập; lấy lại `/auth/csrf` nếu cần.
6. `POST /auth/logout` hủy session, xóa cookie, trả 204. Nếu đăng nhập tiếp thì lấy token mới từ `/auth/csrf`.

## Endpoint

| Method/path           | Request                              | Thành công                                | Lỗi chính                                                                               |
| --------------------- | ------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------- |
| GET `/auth/csrf`      | Không có                             | 200 `{data:{csrfToken}}`                  | 500 khi store lỗi                                                                       |
| POST `/auth/register` | `{email,password,name}`              | 201 `{data:{user}}`                       | 400 VALIDATION_FAILED, 403 CSRF_INVALID, 409 AUTH_EMAIL_TAKEN, 429 RATE_LIMITED         |
| POST `/auth/login`    | `{email,password}`                   | 200 `{data:{user,csrfToken}}`, Set-Cookie | 400 VALIDATION_FAILED, 401 AUTH_INVALID_CREDENTIALS, 403 CSRF_INVALID, 429 RATE_LIMITED |
| GET `/auth/me`        | Cookie                               | 200 `{data:{user,csrfToken}}`             | 401 AUTH_SESSION_EXPIRED / AUTH_SESSION_REPLACED                                        |
| POST `/auth/logout`   | Cookie và CSRF token, không cần body | 204, xóa cookie                           | 401 AUTH_SESSION_EXPIRED / AUTH_SESSION_REPLACED, 403 CSRF_INVALID                      |

`user = {id,email,name,role}`. Email trim/lowercase, tối đa 254 ký tự. Name trim, 1–100 ký tự. Đăng ký yêu cầu password 12–72 ký tự và tối đa 72 UTF-8 bytes để không bị bcrypt cắt mất phần cuối. Đăng nhập chấp nhận password 1–72 ký tự/72 bytes. Password băm bcrypt cost 12; không trim/lowercase password. Payload không nhận trường ngoài schema.

Login sai email hoặc password cùng trả `AUTH_INVALID_CREDENTIALS`. Rate limit fixed window 15 phút: 30 lần/IP và 5 lần/email chuẩn hóa; cả lần thành công đều tính. Đăng ký giới hạn 20 lần/IP/15 phút. Lỗi 429 có `Retry-After: 900` (giới hạn trên để chờ cửa sổ kết thúc). Redis key chỉ chứa digest HMAC, không chứa IP/email thô.

## Session và single-session

- Cookie `connect.sid`, signed bằng `SESSION_SECRET` tối thiểu 32 ký tự; httpOnly, sameSite=lax, path=/, không đặt Domain.
- Idle TTL 28.800 giây (8 giờ). HTTP hợp lệ gia hạn cookie, session và active pointer. Socket handshake/event không gia hạn cookie hoặc Redis TTL.
- Local HTTP: `APP_ENV=dev`, `COOKIE_SECURE=false`. Staging/prod bắt buộc HTTPS và `COOKIE_SECURE=true`. `TRUST_PROXY_HOPS=1` chỉ khi đứng sau đúng một proxy tin cậy; mặc định 0. Không tin X-Forwarded-For từ client tùy ý.
- Prefix `P=oe:<APP_ENV>:v1`. Session `P:sess:<sid>` có `cookie`, `userId`, `role`, `csrfToken`; các trường Auth ở cấp cao nhất để TV3 đọc.
- Pointer `P:auth:user:<userId>:active_session` chứa sid hợp lệ. Lua tạo session mới và thay pointer nguyên tử, xóa session cũ; chỉ chấp nhận session trùng pointer.
- Save/renew chỉ thực hiện khi sid vẫn active và session còn tồn tại. Lua đồng bộ hạn session/pointer; request cũ không thể phục hồi hoặc gia hạn phiên bị thay thế.
- Destroy chỉ xóa pointer nếu nó vẫn trỏ đến chính sid bị hủy. Logout/cleanup của phiên cũ không xóa phiên mới.
- Sau khi session cũ đã bị xóa, request từ cookie cũ có thể nhận `AUTH_SESSION_EXPIRED`; khi session vẫn còn nhưng pointer đã đổi, nhận `AUTH_SESSION_REPLACED`. Frontend xử lý cả hai như yêu cầu đăng nhập lại.
- Mất Redis: từ chối xác thực; không fallback sang MemoryStore. Sau khi Redis mất dữ liệu phải đăng nhập lại. Bài làm/kết quả không thuộc session.

## Bàn giao cho TV2

Auth xuất `AuthSessions` và `AuthRepository`. Bootstrap dùng `PrismaAuthRepository`; model ánh xạ SQL hiện có trong `apps/server/prisma/schema.prisma`. `prisma generate` không thay đổi database. Không chạy `db push`, `migrate dev`, `migrate reset` từ schema này trước khi TV2 baseline đầy đủ: SQL còn có CHECK và partial indexes Prisma không biểu diễn trong schema.

Mount `sessions.sessionMiddleware` trước route nghiệp vụ, sau đó `sessions.requireUser` hoặc `sessions.requireRoles('TEACHER')`. Middleware session cũng bảo vệ CSRF trên method thay đổi dữ liệu. `req.principal = {id,userId,role,sid}`; role check không thay thế kiểm tra chủ sở hữu exam/attempt ở service.

## Bàn giao cho TV3

Chỉ tạo một Socket.IO Server trên HTTP server chung. Bootstrap trên dev đã tạo namespace `/exam` và gắn Auth; TV3 bổ sung handler vào namespace này, không tạo Server thứ hai hoặc đăng ký event vào `/`.

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

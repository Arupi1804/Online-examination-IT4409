# Redis Key Schema (v1)

Contract cho các key Redis của dự án trên Redis 7. PostgreSQL là nguồn dữ liệu chính thức; Redis giữ session, rate limit, cache timer và presence. Worker khôi phục lịch hết giờ từ PostgreSQL. Mất Redis không được làm mất bài làm, đáp án, kết quả hoặc log vi phạm.

## 1. Quy ước chung

- Prefix chung: `P = oe:<env>:v1`, với `<env>` là `dev`, `staging` hoặc `prod`. Ví dụ: `oe:dev:v1:exam:<examId>:runtime`. Dấu `<...>` chỉ chỗ thay giá trị, không phải ký tự lưu trong key.
- Dùng Redis logical DB `0`; prefix phân tách môi trường và loại dữ liệu. Không thay DB bằng `SELECT` trong từng request.
- ID trong key là UUID chữ thường từ PostgreSQL. Không đặt `roomCode`, email, IP hoặc tên người dùng thô trong key.
- Thời gian trong value/score là Unix epoch **milliseconds** do server tạo. TTL/`EX` tính bằng **seconds**; `PEXPIREAT` tính bằng milliseconds. API/Socket.IO gửi thời gian dạng ISO 8601 UTC.
- Mỗi key do ứng dụng sở hữu phải có TTL. Không dùng `KEYS` hoặc wildcard delete trong request; chỉ dùng key đã biết. `SCAN` chỉ dành cho vận hành.
- Quyền ghi: #1 Auth/DevOps sở hữu session và login limit; #2 Exam Core sở hữu trạng thái PostgreSQL; #3 Backend Realtime sở hữu runtime, presence và WebSocket limit. Module khác gọi service của chủ sở hữu thay vì sửa Redis trực tiếp.
- Không cache đáp án đúng, câu trả lời, điểm số hoặc log vi phạm trong Redis.

| Tham số v1               |        Giá trị | Ý nghĩa                                           |
| ------------------------ | -------------: | ------------------------------------------------- |
| `SESSION_IDLE_TTL_SEC`   |  28800 (8 giờ) | Session và con trỏ phiên; cookie có cùng thời hạn |
| `LOGIN_WINDOW_SEC`       |  900 (15 phút) | Cửa sổ giới hạn đăng nhập                         |
| `WS_WINDOW_SEC`          |             60 | Cửa sổ giới hạn event Socket.IO                   |
| `HEARTBEAT_INTERVAL_SEC` |           5–10 | Chu kỳ client gửi `proctor:heartbeat`             |
| `OFFLINE_AFTER_SEC`      |             30 | Ngưỡng đánh dấu offline                           |
| `SUBMIT_GRACE_SEC`       |              5 | Thời gian nộp thủ công sau `endTime`              |
| `RUNTIME_RETAIN_SEC`     | 86400 (24 giờ) | Giữ cache sau `endTime`                           |
| `PRESENCE_RETAIN_SEC`    |   3600 (1 giờ) | Giữ presence sau `endTime`                        |

## 2. Danh mục key do ứng dụng quản lý

`sid` là ID session chỉ phía server dùng. `digest` là HMAC-SHA256 hex của IP hoặc email đã chuẩn hóa (email: `trim` và lowercase), dùng secret riêng của server. IP phải lấy sau khi cấu hình đúng proxy tin cậy; không tin trực tiếp header do client tự đặt.

| Key pattern                           | Redis type / value                                      | Bên ghi | TTL                                                                              | Mục đích / nguồn khôi phục                                                                                   |
| ------------------------------------- | ------------------------------------------------------- | ------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `P:sess:<sid>`                        | String; session đã serialize theo Redis store           | #1      | 8 giờ idle, gia hạn theo hoạt động hợp lệ                                        | Session của `express-session`; hết hạn thì đăng nhập lại. Store phải dùng prefix `P:sess:`.                  |
| `P:auth:user:<userId>:active_session` | String; `sid` được chấp nhận                            | #1      | Bằng TTL session, làm mới cùng session                                           | Single-session; handshake/event nhạy cảm so khớp `sid`.                                                      |
| `P:rl:login:ip:<digest>`              | String; bộ đếm                                          | #1      | 15 phút từ lần thử đầu                                                           | Mặc định 30 lần/15 phút/IP.                                                                                  |
| `P:rl:login:account:<digest>`         | String; bộ đếm                                          | #1      | 15 phút từ lần thử đầu                                                           | Mặc định 5 lần/15 phút/email.                                                                                |
| `P:rl:ws:<userId>:<eventSlug>`        | String; bộ đếm                                          | #3      | 60 giây từ event đầu                                                             | `eventSlug` thay `:` bằng `_`; giới hạn ở mục 4.                                                             |
| `P:exam:<examId>:runtime`             | Hash; `status`, `startTimeMs`, `endTimeMs`              | #3      | DRAFT/SCHEDULED: 1 giờ từ lần đọc; RUNNING: tới `endTime + 24 giờ`; ENDED: 1 giờ | Cache từ `exams.status`, `start_time`, `end_time`; cache miss thì nạp lại DB.                                |
| `P:exam:<examId>:presence`            | Sorted Set; member `attemptId`, score `lastHeartbeatMs` | #3      | Tới `endTime + 1 giờ`, cập nhật khi gia hạn                                      | Online/offline; cache miss thì chờ heartbeat mới.                                                            |
| `P:exam:<examId>:offline_notified`    | Set; các `attemptId` đã phát thông báo offline          | #3      | Cùng hạn với `presence`                                                          | Chống phát `monitor:student_update` offline lặp lại trong mỗi lượt quét; mất key thì tính lại từ `presence`. |

`presence` chỉ tồn tại khi kỳ thi đã có `endTime`. Không có TTL riêng cho member trong Sorted Set; member cũ được coi là offline theo score.

## 3. Dữ liệu và vòng đời

### Session / single-session (#1)

`P:sess:<sid>` do session store quản lý. Khi đăng nhập, #1 tạo session, thay `P:auth:user:<userId>:active_session` bằng `sid` mới và lấy `sid` cũ bằng thao tác nguyên tử (ví dụ `SET key newSid EX 28800 GET` trên Redis 7). Sau đó xóa session cũ và phát `session:replaced` đến socket cũ.

Khi logout hoặc gia hạn TTL con trỏ, so khớp `sid` bằng Lua trước khi `DEL`/`EXPIRE`: phiên cũ không được xóa hay gia hạn phiên mới. Handshake Socket.IO dùng cùng session store, kiểm tra active session, và không tin `userId` do client gửi. Chỉ HTTP response có gia hạn cookie mới được gia hạn session Redis và con trỏ cùng lúc; heartbeat Socket.IO không tự kéo dài TTL. Event đến sau khi session hết hạn phải bị từ chối và socket bị ngắt.

### Runtime kỳ thi (#2 và #3)

Ví dụ Hash `P:exam:<examId>:runtime`:

```text
status       RUNNING  (DRAFT | SCHEDULED | RUNNING | ENDED)
startTimeMs  <epoch-ms>
endTimeMs    <epoch-ms>
```

#2 cập nhật `exams` bằng transaction và trả trạng thái đã commit. #3 ghi cache, đặt lại TTL và phát `exam:started`, `exam:extended`, `timer:sync` hoặc `exam:ended`. Trước khi bắt đầu thi có thể chưa có `startTimeMs`/`endTimeMs`. Nếu nhiều thay đổi chồng nhau, đọc lại trạng thái DB và thay cache bằng giá trị mới; không dùng một bản cache cũ ghi đè sau thay đổi mới.

Mọi kiểm tra quyền, gia hạn, hết giờ và nộp bài dựa vào PostgreSQL. Khi Redis/server khởi động lại, #3 truy vấn các kỳ thi `RUNNING` từ PostgreSQL để nạp `end_time` và dựng lại timer. Không kết luận kỳ thi đã kết thúc chỉ vì key Redis hết hạn. `timer:sync` gửi `endTime` và `serverTime` mỗi 10–15 giây.

### Presence và giám sát (#3)

Chỉ nhận heartbeat khi session, quyền sở hữu attempt và trạng thái kỳ thi/bài làm hợp lệ. Server dùng giờ của mình và `ZADD GT` để heartbeat đến muộn không kéo lùi `lastHeartbeatMs`. Nhiều socket của cùng attempt vẫn được coi là online nếu một socket tiếp tục gửi heartbeat.

Dashboard coi attempt online khi `lastHeartbeatMs >= nowMs - 30000`. Khi socket ngắt, chờ hết ngưỡng 30 giây thay vì đánh dấu offline ngay. Mỗi 10 giây, #3 xét các attempt đang thi theo Sorted Set; khi quá ngưỡng, thêm vào `offline_notified` và chỉ phát `monitor:student_update` nếu `SADD` trả về 1. Heartbeat mới xóa attempt khỏi Set và phát online nếu trước đó offline. Kiểm tra score và cập nhật Set phải nguyên tử để tránh heartbeat đến đúng lúc quét offline. Có thể `ZREM` khi bài đã nộp. Danh sách attempt lấy từ PostgreSQL rồi đối chiếu Sorted Set; không quét toàn bộ Redis.

`answeredCount` lấy từ `answers`/service #2; `violationCount` và `lastViolation` lấy từ `proctor_logs`. Với `proctor:violation`, ghi DB trước khi phát `monitor:student_update`. `proctor_logs.at` là giờ server nhận; `client_at` chỉ để tham khảo. Không dùng `answeredCount` hay `at` client gửi làm dữ liệu chính thức.

## 4. Rate limit

Counter dùng cửa sổ cố định; TTL đặt một lần khi tăng từ 0 lên 1, không gia hạn sau mỗi event. Dùng Lua để `INCR` và đặt TTL lần đầu trong một thao tác nguyên tử, tránh counter không có TTL khi process dừng giữa chừng.

| Nhóm                                                | Key                                  | Giới hạn mặc định |
| --------------------------------------------------- | ------------------------------------ | ----------------: |
| Login theo tài khoản                                | `P:rl:login:account:<digest>`        |       5 / 15 phút |
| Login theo IP                                       | `P:rl:login:ip:<digest>`             |      30 / 15 phút |
| `proctor:heartbeat`                                 | `P:rl:ws:<userId>:proctor_heartbeat` |         20 / phút |
| `proctor:violation`                                 | `P:rl:ws:<userId>:proctor_violation` |         30 / phút |
| `room:join`, `attempt:rejoin`                       | `P:rl:ws:<userId>:<eventSlug>`       | 20 / phút / event |
| `exam:start`, `exam:extend`, `attempt:force_submit` | `P:rl:ws:<userId>:<eventSlug>`       | 10 / phút / event |

REST trả HTTP 429 khi vượt giới hạn; Socket.IO trả ACK lỗi theo `docs/ws-events.md`. Rate limit không thay thế xác thực session và kiểm tra quyền trên `examId`/`attemptId`.

## 5. Auto-submit, gia hạn và thời gian nộp

Quy tắc v1 giải quyết xung đột giữa nộp thủ công và job tự nộp:

1. `endTime = exams.end_time` là mốc dừng lưu đáp án. API nộp bài chấp nhận nộp thủ công khi `now <= endTime + 5 giây`, kể cả khi kỳ thi đã đóng nhận câu trả lời mới; sau đó trả `SUBMIT_TOO_LATE`.
2. Realtime worker đặt timer cục bộ tại `endTimeMs + 5001` và đối chiếu PostgreSQL mỗi 10 giây. Khi đến hạn, worker khóa dòng `exams` và các attempt còn `IN_PROGRESS` trong transaction, chấm/nộp đúng một lần, rồi chuyển exam thành `ENDED`.
3. `exam:extend` cập nhật DB trước, sau đó đặt lại timer. Timer cũ phải đọc `exams.end_time` dưới khóa; nếu hạn đã đổi thì không nộp dựa trên thời gian cũ.
4. Khi server khởi động hoặc timer mất, worker quét kỳ thi `RUNNING` và cả kỳ thi `ENDED` còn attempt chưa nộp từ PostgreSQL. Chỉ phát `exam:ended` sau khi transaction đã commit.

Triển khai v1 dùng PostgreSQL làm nguồn khôi phục job, không tạo key queue trong Redis. Mỗi server instance có thể chạy worker vì transaction và trạng thái attempt bảo vệ tính idempotent; khi chạy nhiều instance cần Socket.IO Redis adapter để phát sự kiện đến socket ở instance khác.

## 6. Socket.IO rooms và adapter

`exam:<examId>`, `monitor:<examId>` và `user:<userId>` là tên room Socket.IO, **không phải Redis key** của ứng dụng. `room:join` phải kiểm tra quyền từ PostgreSQL. Sau reconnect, socket join lại room; `attempt:rejoin` lấy answers/status từ PostgreSQL.

Khi chạy nhiều server instance, Socket.IO Redis adapter có thể dùng Pub/Sub channel prefix `P:sio`. Channel không có TTL và tên cụ thể thuộc adapter; một instance chưa cần adapter. Pub/Sub không lưu message khi consumer ngắt kết nối.

## 7. Lỗi, khôi phục và thay đổi schema

- Redis mất dữ liệu: session mất thì đăng nhập lại; runtime/timer được dựng lại từ PostgreSQL; presence trở lại khi có heartbeat. Answers, điểm và log vẫn ở PostgreSQL.
- Redis ghi lỗi sau khi DB commit: giữ kết quả DB, log lỗi và thử đồng bộ lại cache từ DB. Không đảo ngược transaction DB vì cache lỗi.
- Xóa kỳ thi/người dùng hợp lệ: sau DB commit chỉ xóa đúng key liên quan. Không dùng `FLUSHDB` trong ứng dụng.
- Không log `sid`, cookie, IP/email thô, payload đáp án hoặc secret. Chỉ cho Redis truy cập từ mạng tin cậy; môi trường khác nhau dùng prefix khác nhau.
- Thêm key hoặc đổi type/TTL phải cập nhật file này cùng code. Đổi value không tương thích phải tăng phiên bản prefix (`v2`) và có kế hoạch xử lý key cũ.

# Frontend Online Examination

React 18, Vite 6, TypeScript 5.8, Tailwind CSS 3 và pnpm 10.11.
Chạy lệnh tại root repository với Node 20.19.5. Frontend là package
`@online-exam/client`; toàn workspace dùng duy nhất `pnpm-lock.yaml` ở root.

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd --filter @online-exam/shared build
pnpm.cmd --filter @online-exam/client dev
```

Mở `http://localhost:5173/login`.

Frontend gọi API Auth tại `/api/v1/auth/*` với cookie session. Cấu hình
`VITE_API_URL` để trỏ tới backend chạy riêng, hoặc dùng Vite proxy cổng 3000.
Request/response và validation được đối chiếu với `docs/openapi.yaml` trên
nhánh `dev` đã merge và kiểm chứng.
Đăng ký gửi email, mật khẩu, họ tên và tạo tài khoản thí sinh.

Để thử UI riêng, đặt `VITE_USE_MOCK=true` trong `apps/client/.env.local` rồi
khởi động lại Vite. Tài khoản mock là `student1@test.com`, mật khẩu `Test@1234`.
Tài khoản vừa đăng ký trong mock tồn tại đến khi tải lại trang.

## Phòng thi thí sinh

Sau đăng nhập, mở `/join`, nhập mã 6 ký tự do giáo viên cung cấp. Frontend
tra cứu bằng `POST /api/v1/exams/join`, rồi vào `/exam/:examId/waiting`
và gửi `room:join` bằng Socket.IO với cookie session. Việc vào phòng chờ
không tạo bài làm. Khi nhận trạng thái RUNNING từ realtime, frontend chuyển
đến `/exam/:examId/take` (giao diện làm bài thuộc tuần 4).

Phòng chờ có thông tin kỳ thi, trạng thái kết nối, số kết nối trong phòng,
thông tin của thí sinh và nút rời phòng. Mã phòng được lưu theo tài khoản
trong sessionStorage; khi tải lại, frontend tra cứu và xác nhận lại với server.
Kết nối lại cũng gửi `room:join` để khôi phục trạng thái mới nhất.

Trong mock development, dùng `K7M2QX` cho phòng chờ, `RUN2AB` cho kỳ thi
đang chạy và `ENDED2` để thử lỗi kỳ thi đã kết thúc. Các mã khác báo không
tìm thấy phòng. Mock không tự bắt đầu kỳ thi và không kết nối backend thật.

Hai adapter phòng chờ và bài làm dùng namespace `/exam` từ shared contract.
Engine.IO vẫn đi qua Vite proxy `/socket.io` tới cổng 3000. Khi backend
chạy riêng, đặt `VITE_API_URL` thành origin của backend (ví dụ
`http://localhost:3000`, không kèm `/api/v1`). Có thể đặt riêng
`VITE_REALTIME_URL` nếu realtime ở origin khác. Backend phải cho phép origin
frontend và cookie session khi gọi chéo origin.

REST tham chiếu `docs/openapi.yaml` trên `origin/dev` tại `0411336`.
Adapter realtime tham chiếu `docs/ws-events.md` trên `origin/feature/realtime`;
payload chi tiết này chưa được merge vào `dev`, cần xác nhận tích hợp với #3.
Nhánh `dev` hiện có Auth/Questions; các endpoint phòng thi, bài làm, kết quả
và handler realtime vẫn cần được backend ghép vào trước khi kiểm tra toàn luồng thật.
Contract hiện có `participantCount` là số socket, chưa có danh sách tên
thí sinh. Frontend không gọi API chi tiết đề thi của giáo viên để lấy dữ liệu.

## Làm bài thi thí sinh

Tại `/exam/:examId/take`, frontend gọi `POST /api/v1/exams/:examId/attempts`
để nhận hoặc khôi phục bài IN_PROGRESS. Giữ nguyên thứ tự câu hỏi/đáp án do
server trả về; hỗ trợ SINGLE, MULTIPLE và TRUE_FALSE. Không lấy đáp án đúng
từ endpoint giáo viên, không chấm điểm trên trình duyệt.

Mỗi thay đổi đáp án tự gọi `PUT /api/v1/attempts/:attemptId/answers/:questionId`
với `{ selectedOptionIds }`; mảng rỗng là bỏ chọn. Mỗi câu chỉ có một request
đang gửi, lựa chọn mới nhất được gửi tiếp sau khi request trước kết thúc.
UI phân biệt đang lưu, đã lưu và lỗi lưu; khi lỗi, giữ lựa chọn trong bộ nhớ
và cho phép thử lại. Các request REST của bài thi có timeout 12 giây.

Đánh dấu câu và vị trí đang xem được lưu trong sessionStorage theo tài khoản
và bài làm, không gửi lên API. Khi tải lại, đáp án lấy từ backend; cờ đánh dấu
lấy từ trình duyệt. Chuyển trang hoặc đăng xuất khi có đáp án chưa lưu sẽ chờ
lưu hoặc cho biết lỗi. Tải lại/đóng tab khi còn thay đổi chưa lưu có cảnh báo
của trình duyệt. Đáp án chưa gửi được lưu riêng theo tài khoản và bài làm
trong sessionStorage để khôi phục sau khi tải lại trang.

Đồng hồ dùng `endTime`, `serverTime`, thời gian đơn điệu `performance.now()`
và ước lượng nửa RTT khi nhận đề/ACK. Đồng bộ `timer:sync`, `exam:extended`
và `exam:ended` qua Socket.IO. Hết giờ chỉ khóa chỉnh sửa; không tự gọi submit
và không tự coi bài đã nộp. Chỉ xác nhận hoàn tất sau response submit thành
công, trạng thái đã nộp từ API hoặc `attempt:submitted` đúng bài làm.

Nút **Nộp bài** mở xác nhận với số câu đã/chưa trả lời và câu đánh dấu. Khi
xác nhận, chờ toàn bộ đáp án lưu thành công rồi gọi
`POST /api/v1/attempts/:attemptId/submit`. Sau khi server xác nhận, chuyển sang
`/exam/:examId/results?attemptId=...` để lấy kết quả từ API.

Router dùng `createBrowserRouter` để chặn điều hướng khi có thay đổi chưa lưu;
giữ nguyên URL các trang hiện có. REST tiếp tục theo OpenAPI trên `origin/dev`,
realtime theo contract đang phát triển của #3 như đã nêu ở trên.

Trong mock development, đăng nhập rồi dùng mã **RUN2AB** để làm bài mẫu 6 câu.
Bài làm được lưu theo tài khoản trên trình duyệt và khôi phục khi tải lại.
Mã **K7M2QX** vẫn là phòng chờ. Sau khi nộp, mock khôi phục trạng thái đã nộp,
không tự tạo lượt mới. Để thử lại từ đầu, xóa mục `oe:dev:attempt:...` tương
ứng trong sessionStorage qua DevTools. Việc mô phỏng tự chốt bài khi hết giờ
chỉ nằm trong mock development; backend thật chịu trách nhiệm chốt/chấm bài.

## Kết quả và khôi phục kết nối

Trang kết quả gọi `GET /api/v1/attempts/:attemptId/result`, kiểm tra ID bài làm
và kỳ thi trước khi hiển thị. Có điểm, thời gian làm bài và hình thức nộp
(thủ công, tự chốt hoặc giáo viên chốt). Không gọi POST tạo bài mới để tìm
kết quả. Tham chiếu bài làm gần nhất được lưu theo tài khoản để hỗ trợ URL
cũ không có query; sau nộp, URL luôn có attemptId nên vẫn tải lại được khi
trình duyệt chặn storage.

Điểm hiển thị ngay theo response của server. Khi `questions: null`, chưa
hiển thị đáp án đúng/lời giải hay tự suy ra số câu đúng. Khi server công bố
chi tiết sau khi kỳ thi ENDED, nút **Tải lại kết quả** cho phép xem từng câu,
đáp án đã chọn, đáp án đúng, điểm từng câu và lời giải. Điểm một phần lấy từ
`earnedPoints`, không chấm lại trên frontend. Response thiếu điểm, sai schema
hoặc không khớp ID được báo lỗi, không thay bằng điểm 0.

Sau mỗi kết nối/reconnect, Socket.IO gửi `room:join` rồi `attempt:rejoin`.
Frontend xác nhận trạng thái bài, đồng hồ và đáp án đã lưu trước khi gửi
tiếp đáp án đang chờ. Lựa chọn chưa gửi được giữ trên trang và trong
sessionStorage; nếu storage bị chặn, UI nhắc giữ trang mở. Đồng hồ vẫn chạy
khi offline, không cho nộp khi chưa xác nhận lại kết nối. Bài đã bị chốt sẽ
chuyển sang kết quả và xóa hàng đợi cục bộ, không gửi lại đáp án trễ hạn.
Đáp án đã được server lưu không bị lựa chọn cũ từ cache ghi đè trừ khi
câu đó có thay đổi chưa được xác nhận trên chính phiên trình duyệt này.

## Giám sát bài thi

Frontend dùng đủ bốn loại từ `ViolationType` trong `@online-exam/shared`:
`TAB_BLUR`, `FULLSCREEN_EXIT`, `COPY_PASTE` và `DISCONNECT`. Payload gửi qua
`proctor:violation` chỉ có `attemptId`, `type`, `clientAt`; server quyết định
danh tính, thời điểm ghi log và chính sách xử lý. Không dùng window blur
làm bằng chứng chuyển tab.

`COPY_PASTE` quan sát sự kiện copy/cut khi toàn bộ vùng chọn nằm trong khung
câu hỏi và paste khi đích thao tác nằm trong khung đó. Thao tác ngoài vùng
câu hỏi không tạo log. Frontend chỉ kiểm tra ranh giới vùng chọn/đích sự
kiện, không đọc hoặc gửi nội dung clipboard, không chặn thao tác mặc định.

`DISCONNECT` được ghi nhận sau khi đã có kết nối/rejoin hợp lệ, khi browser
báo offline, socket bị ngắt hoặc heartbeat không nhận được ACK. Các tín hiệu
của cùng một đợt gián đoạn được gộp thành một sự kiện. Lần vào phòng đầu,
nút kết nối lại, đăng xuất và dọn socket không tự tạo log. Sự kiện chưa từng
gửi được giữ trong bộ nhớ, chỉ gửi một lần sau khi rejoin xác nhận bài còn
IN_PROGRESS và còn thời gian. Bài đã chốt hoặc hết giờ sẽ bỏ sự kiện đang
chờ, không gửi log trễ. Log đã gửi nhưng chưa rõ ACK không được phát lại.
Nhật ký cục bộ mất khi reload/đóng trang; trạng thái online/offline chính
thức vẫn do #3 xác định từ heartbeat với ngưỡng 30 giây theo contract Redis.

Nút **Vào toàn màn hình** dùng Fullscreen API từ thao tác trực tiếp của người
dùng. Không ghi thoát fullscreen trước khi thực sự vào fullscreen; trình
duyệt không hỗ trợ/từ chối sẽ có thông báo và vẫn cho làm bài. Giám sát dừng
khi hết giờ, đang nộp hoặc bài đã được chốt; không tự nộp bài hay áp dụng
hình phạt vì một sự kiện trình duyệt.

`proctor:heartbeat` gửi sau khi rejoin và mỗi 10 giây khi bài còn thời gian.
UI phân biệt số sự kiện phát hiện trên thiết bị với số đã nhận ACK từ server.
Không tự phát lại log chưa rõ đã ghi hay chưa sau mất kết nối: contract hiện
chưa có khóa chống ghi log trùng. Nhật ký frontend không thay thế log trên
server và sẽ được khởi tạo lại khi tải lại trang.

```powershell
pnpm.cmd check
pnpm.cmd --filter @online-exam/client test:e2e
```

Unit test dùng fetch giả lập, độc lập với URL backend trong `.env.local`.
Các E2E test dùng HTTP response fixtures theo contract Auth/ExamJoinInfo
và AttemptPaper/SavedAnswer/submit/result cùng Socket.IO server test tại cổng 5190.
Fixture chỉ nhận sự kiện tại namespace `/exam`, từ chối namespace `/` để bắt
lỗi cấu hình adapter. Bộ smoke test tại root dùng Auth/backend thật, chạy
bằng `pnpm.cmd test:e2e` khi PostgreSQL và Redis đã sẵn sàng.
Kiểm tra ACK, sự kiện, reconnect, timeout, thứ tự autosave, khôi phục bài,
nộp bài sau khi lưu xong, khóa khi hết giờ, mất mạng/reload, heartbeat,
đủ bốn loại sự kiện giám sát, bảo vệ kết quả chưa công bố và dọn kết nối.
Đây là kiểm chứng frontend với backend
giả lập, chưa thay thế kiểm tra tích hợp backend thật. Cần để trống cổng
5174 và 5190 khi chạy E2E.
Để dùng Edge đã cài, đặt `$env:PLAYWRIGHT_CHANNEL = "msedge"` trước khi chạy.

## Responsive và kiểm thử luồng thí sinh

Giao diện hỗ trợ màn hình từ 320px, nội dung câu hỏi/đáp án dài và hộp thoại
cuộn khi màn hình thấp. Danh sách câu hỏi có nút đi nhanh trên mobile/tablet;
liên kết **Đến nội dung chính** xuất hiện khi dùng Tab. Chọn câu đưa focus
về tiêu đề, hộp thoại dùng modal của trình duyệt và Escape để ở lại bài.

Test case, dữ liệu, bước chạy và giới hạn tích hợp được mô tả tại
[tests/README.md](tests/README.md). Suite `student-qa.spec.ts` kiểm tra luồng
đăng nhập → phòng chờ → làm bài → kết quả → đăng xuất ở 320/375/768/1280px,
bàn phím, chữ 200%, reduced motion và hộp thoại khi xoay ngang. Suite này dùng
REST/Socket.IO fixtures. Suite E2E tại root có thêm đăng ký/đăng nhập,
khôi phục cookie session và đăng xuất bằng PostgreSQL/Redis/backend thật.

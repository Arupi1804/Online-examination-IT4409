# Frontend Online Examination

React 18, Vite 6, TypeScript 5.8, Tailwind CSS 3 và pnpm 10.11.
Chạy lệnh tại `apps/client` với Node 20.19.5.

```powershell
pnpm.cmd install
pnpm.cmd build
pnpm.cmd dev
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

Socket.IO mặc định đi qua Vite proxy `/socket.io` tới cổng 3000. Khi backend
chạy riêng, đặt `VITE_API_URL` thành origin của backend (ví dụ
`http://localhost:3000`, không kèm `/api/v1`). Có thể đặt riêng
`VITE_REALTIME_URL` nếu realtime ở origin khác. Backend phải cho phép origin
frontend và cookie session khi gọi chéo origin.

REST tham chiếu `docs/openapi.yaml` trên `origin/dev` tại `eda2bef`.
Adapter realtime tham chiếu `docs/ws-events.md` trên `origin/feature/realtime`;
payload này chưa được merge vào `dev`, cần xác nhận tích hợp với #3.
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
của trình duyệt. Không có hàng đợi offline bền vững trong tuần 4.

Đồng hồ dùng `endTime`, `serverTime`, thời gian đơn điệu `performance.now()`
và ước lượng nửa RTT khi nhận đề/ACK. Đồng bộ `timer:sync`, `exam:extended`
và `exam:ended` qua Socket.IO. Hết giờ chỉ khóa chỉnh sửa; không tự gọi submit
và không tự coi bài đã nộp. Chỉ xác nhận hoàn tất sau response submit thành
công, trạng thái đã nộp từ API hoặc `attempt:submitted` đúng bài làm.

Nút **Nộp bài** mở xác nhận với số câu đã/chưa trả lời và câu đánh dấu. Khi
xác nhận, chờ toàn bộ đáp án lưu thành công rồi gọi
`POST /api/v1/attempts/:attemptId/submit`. Trang xác nhận nộp không hiển thị
điểm/đáp án đúng; trang kết quả và proctoring thuộc tuần 5.

Router dùng `createBrowserRouter` để chặn điều hướng khi có thay đổi chưa lưu;
giữ nguyên URL các trang hiện có. REST tiếp tục theo OpenAPI trên `origin/dev`,
realtime theo contract đang phát triển của #3 như đã nêu ở trên.

Trong mock development, đăng nhập rồi dùng mã **RUN2AB** để làm bài mẫu 6 câu.
Bài làm được lưu theo tài khoản trên trình duyệt và khôi phục khi tải lại.
Mã **K7M2QX** vẫn là phòng chờ. Sau khi nộp, mock khôi phục trạng thái đã nộp,
không tự tạo lượt mới. Để thử lại từ đầu, xóa mục `oe:dev:attempt:...` tương
ứng trong sessionStorage qua DevTools. Việc mô phỏng tự chốt bài khi hết giờ
chỉ nằm trong mock development; backend thật chịu trách nhiệm chốt/chấm bài.

```powershell
pnpm.cmd check
pnpm.cmd test:e2e
```

Unit test dùng fetch giả lập, độc lập với URL backend trong `.env.local`.
Các E2E test dùng HTTP response fixtures theo contract Auth/ExamJoinInfo
và AttemptPaper/SavedAnswer/submit cùng Socket.IO server test tại cổng 5190.
Kiểm tra ACK, sự kiện, reconnect, timeout, thứ tự autosave, khôi phục bài,
nộp bài sau khi lưu xong, khóa khi hết giờ và dọn kết nối. Đây là kiểm chứng frontend với backend
giả lập, chưa thay thế kiểm tra tích hợp backend thật. Cần để trống cổng
5174 và 5190 khi chạy E2E.
Để dùng Edge đã cài, đặt `$env:PLAYWRIGHT_CHANNEL = "msedge"` trước khi chạy.

# Kiểm thử frontend thí sinh

Chạy lệnh PowerShell tại root repository. Dùng Node 20.19.5 và pnpm 10.11.0.
Các ca dưới đây là tài liệu QA chung của frontend, có thể dùng lại sau mỗi lần
tích hợp; kết quả một lần chạy không thay cho kết quả trên staging.

## Các mức kiểm tra

- `pnpm.cmd --filter @online-exam/client check`: lint, TypeScript, unit test và
  production build. Unit test dùng fetch giả lập.
- `pnpm.cmd --filter @online-exam/client test:e2e`: giao diện thật trên trình duyệt,
  REST bị chặn bằng Playwright fixtures và Socket.IO test server tại `/exam`.
  Không khởi động backend dự án; cần để trống cổng 5174 và 5190.
- `pnpm.cmd test:e2e`: smoke test qua Vite proxy, Express, PostgreSQL và Redis thật.
  Cần `.env` hợp lệ, database đã có schema theo `database/README.md` và cổng
  3000/5173 còn trống. Test đăng ký tạo email UUID riêng, thu hồi session và xóa
  đúng tài khoản đó trong bước dọn dẹp. Dùng database phát triển/kiểm thử.
- `pnpm.cmd check`: kiểm tra cả workspace. Đặt `AUTH_DATABASE_URL` và
  `AUTH_REDIS_URL` trỏ đến database/Redis kiểm thử để chạy các integration test
  Auth; nếu thiếu, Vitest bỏ qua các nhóm tương ứng. Test Questions đọc
  `DATABASE_URL` từ `.env` tại root. Kiểm tra số test bị skip trong output.

Với volume PostgreSQL đã tồn tại, Docker không tự chạy lại SQL init. Nếu
Auth hoạt động nhưng Questions trả 500, kiểm tra `options.order_index`,
`questions.updated_at` và `exams.updated_at` có khớp Prisma schema không.
Thiếu các cột này nghĩa là database chưa có `002_exam_core.sql`; xem
[hướng dẫn database](../../../database/README.md) và phối hợp với người phụ
trách dữ liệu trước khi cập nhật database đang dùng. Có thể kiểm thử trên
database tạm riêng, nạp lần lượt cả hai file SQL, thay `DATABASE_URL` và
`AUTH_DATABASE_URL` trong terminal kiểm thử mà không sửa `.env`.

Để chạy bằng Edge đã cài:

```powershell
$env:PLAYWRIGHT_CHANNEL = 'msedge'
pnpm.cmd --filter @online-exam/client test:e2e
```

Chạy riêng các ca responsive, bàn phím và luồng xuyên suốt:

```powershell
pnpm.cmd --filter @online-exam/client test:e2e student-qa.spec.ts
```

Playwright tạo HTML report trong `apps/client/playwright-report`, ảnh trong
`apps/client/test-results`, kèm screenshot và trace khi lỗi. Mở report bằng:

```powershell
pnpm.cmd --filter @online-exam/client exec playwright show-report
```

Các thư mục kết quả đã được Git bỏ qua. Không đưa ảnh, trace hoặc tài khoản
kiểm thử vào commit. Với suite backend thật ở root, kết quả nằm tại root.

## Test case tự động

### QA-UI-320 / QA-UI-375 / QA-UI-768 / QA-UI-1280

Nguồn: [student-qa.spec.ts](e2e/student-qa.spec.ts). Mỗi ca tạo phiên trình duyệt
mới, tài khoản có tên dài, tiêu đề/câu hỏi/đáp án có chuỗi dài không có khoảng
trắng. Kích thước lần lượt là 320×640, 375×812, 768×1024 và 1280×800.

1. Đăng nhập, nhập mã `k7m2qx` và vào phòng chờ.
2. Nhận sự kiện bắt đầu từ Socket.IO test server.
3. Chọn đáp án SINGLE, MULTIPLE và TRUE_FALSE; đánh dấu câu; đổi câu.
4. Mở xác nhận nộp, nộp bài, mở chi tiết kết quả rồi đăng xuất.

Mong đợi: mã được chuẩn hóa; phòng chỉ chuyển khi nhận sự kiện hợp lệ; mọi
đáp án được lưu trước khi nộp. Trang và khung con không tràn ngang/cắt nội
dung; nút số câu có vùng bấm ít nhất 44×44px; tiêu đề câu nhận focus và không
bị đồng hồ che khi đổi câu. Trên mobile/tablet có đường đi nhanh đến danh
sách câu hỏi. Chỉ gửi một lần nộp; kết quả có lời giải; sau đăng xuất không
truy cập được `/join`. Console không có lỗi JavaScript. Có ảnh phòng chờ,
bài thi và kết quả cho từng kích thước.

### QA-KEYBOARD

Nguồn: [student-qa.spec.ts](e2e/student-qa.spec.ts).

1. Tải lại trang nhập mã, dùng Tab → Enter ở liên kết đến nội dung chính.
2. Nhập mã và gửi bằng Enter; sau khi bắt đầu, chọn radio bằng Space.
3. Mở hộp thoại nộp bằng Enter; đi tới các nút bằng Tab/Shift+Tab, thử đưa
   focus về nút phía sau hộp thoại; nhấn Escape.

Mong đợi: nội dung chính nhận focus; radio hoạt động bằng bàn phím; nút tiếp
tục làm bài nhận focus đầu tiên. Trang phía sau hộp thoại không nhận focus.
Escape đóng hộp thoại, trả focus về nút Nộp bài và không gửi bài.

### QA-DIALOG

Nguồn: [student-qa.spec.ts](e2e/student-qa.spec.ts).

1. Ở 320×640, cho API lưu đáp án trả 503 rồi bấm logo để rời trang.
2. Kiểm tra hộp thoại giữ đáp án, nhấn Escape để ở lại.
3. Mở xác nhận nộp và đổi kích thước sang 640×320; cho API hoạt động lại,
   bấm thử lưu, cuộn tới nút xác nhận và nộp.

Mong đợi: nút rời trang dài xuống dòng, không bị cắt; Escape giữ lựa chọn.
Hộp thoại nằm trong chiều cao viewport và cuộn được; lưu lại thành công mới
cho xác nhận nộp; kết quả chỉ mở sau response nộp thành công.

### QA-TEXT

Nguồn: [student-qa.spec.ts](e2e/student-qa.spec.ts).

1. Ở 375×812, bật reduced motion và tăng cỡ chữ gốc lên 200%.
2. Gửi form đăng ký trống; mở bài thi và hộp thoại nộp.

Mong đợi: focus tới trường lỗi đầu tiên, trường email liên kết mô tả lỗi
bằng `aria-describedby`; form, nội dung và nút thao tác không tràn ngang.
Đóng hộp thoại không gửi bài. Đây là kiểm tra tăng cỡ chữ, chưa thay thế
zoom và trình đọc màn hình trên thiết bị thật.

### QA-AUTH-LIVE

Nguồn: [workspace.spec.ts](../../../tests/e2e/workspace.spec.ts); chạy bằng
`pnpm.cmd test:e2e` từ root. Suite backend thật nằm trong `tests/e2e` tại root;
các suite frontend dùng fixtures tiếp tục nằm trong `apps/client/tests/e2e`.

1. Đăng ký tài khoản UUID riêng qua form thật, đăng nhập và mở `/join`.
2. Tải lại trang để xác nhận cookie session còn hiệu lực.
3. Đăng xuất, mở lại `/join` rồi dọn tài khoản kiểm thử.

Mong đợi: tạo STUDENT thành công, họ tên hiển thị đúng, tải lại vẫn đăng
nhập, sau đăng xuất quay về login. Suite còn kiểm tra health qua proxy,
credentials sai trả 401 và request từ Origin khác bị từ chối 403.

### QA-PROCTOR

Nguồn: [exam.spec.ts](e2e/exam.spec.ts) và
[week5.test.ts](week5.test.ts). REST và Socket.IO dùng fixtures.

- Chuyển tab/thoát fullscreen: giữ các ca đã có; chuyển trạng thái lặp
  không tạo log trùng; hết giờ dừng quan sát.
- Sao chép/cắt/dán: chỉ thao tác trong khung câu hỏi tạo `COPY_PASTE`;
  thao tác ngoài khung không tạo log. Payload chỉ có ID bài, loại sự kiện
  và clientAt; không có nội dung clipboard. Thao tác mặc định vẫn hoạt động,
  đáp án vẫn chọn/lưu được và không tự nộp bài.
- Browser offline: trong lúc mất mạng chưa gửi `DISCONNECT`; khi rejoin
  thành công, gửi đúng một log cho đợt gián đoạn và tiếp tục lưu đáp án.
- Mất socket trong khi browser vẫn online: chờ rejoin trước khi gửi log.
  ACK bị mất không khiến log cũ bị phát lại; một đợt mất socket mới có
  timestamp và log riêng.
- Lần kết nối đầu, nút kết nối lại và đăng xuất: không tạo `DISCONNECT`.
- Hết giờ hoặc server chốt bài trong lúc offline: không phát log mất kết
  nối đang chờ và không nhận thêm sự kiện clipboard sau hạn.

Các ca clipboard tự động phát DOM events với vùng chọn thật trong trang;
không truy cập clipboard hệ điều hành. Khi kiểm thử thủ công, thử thêm
phím tắt và menu ngữ cảnh trên các trình duyệt nhóm hỗ trợ. Đối chiếu cả
bốn loại với `proctor_logs` sau khi handler realtime của #3 được tích hợp.

## Hồi quy và kiểm thử tích hợp tiếp theo

Các ca đã có trong [auth.spec.ts](e2e/auth.spec.ts),
[room.spec.ts](e2e/room.spec.ts), [exam.spec.ts](e2e/exam.spec.ts) kiểm tra
validation, timeout, mất phiên, reconnect/rejoin, autosave tuần tự, tải lại
khi offline, khóa lúc hết giờ, heartbeat, chuyển tab/fullscreen, đáp án chưa
công bố và lỗi result. Chạy toàn bộ suite khi sửa luồng thí sinh.

Khi backend nghiệp vụ được tích hợp vào `dev`, chạy lại các tình huống sau
với hai trình duyệt/tài khoản giáo viên và thí sinh, ghi browser/viewport,
commit, bước tái hiện, kỳ vọng, thực tế và ảnh/trace nếu lỗi:

- Phòng: giáo viên tạo/phát mã; thí sinh nhập mã hợp lệ/sai/đã kết thúc;
  xác nhận thông tin phòng, số kết nối, bắt đầu thi và rời phòng.
- Bài thi: ba loại câu hỏi; chọn nhanh nhiều lần; bỏ chọn; reload và khôi
  phục; so sánh đáp án trên server; nộp khi còn câu chưa trả lời.
- Kết nối: ngắt mạng khi đang lưu; đổi đáp án; reload offline rồi nối lại;
  xác nhận rejoin trước khi phát lại và không ghi đè đáp án mới trên server.
- Thời gian: server gia hạn, hết giờ và giáo viên chốt trong lúc thí sinh
  offline; xác nhận đáp án trễ không được gửi lại, bài không nộp hai lần.
- Kết quả: điểm khớp server; chi tiết ẩn trước công bố; công bố và tải lại;
  tài khoản khác không đọc được kết quả bằng cách sửa URL/attemptId.
- Phiên và giám sát: đăng nhập thiết bị khác, session hết hạn, chuyển tab,
  vào/thoát fullscreen; đối chiếu log/heartbeat trên server.

Sau khi merge `dev`, backend có Auth, Questions, CRUD/publish/join của Exams
và xác thực namespace. Các route tạo/lưu/nộp bài làm, lấy kết quả và handler
realtime tương ứng chưa được mount. Luồng kỳ thi dùng fixtures chưa được
tính là đạt tích hợp thật.
Cũng cần kiểm tra Chrome/Firefox/Safari, thiết bị cảm ứng và trình đọc màn
hình thực tế trước khi chốt QA toàn hệ thống.

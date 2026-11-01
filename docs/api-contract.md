# REST API contract

Base URL: `/api/v1`. Request/response, role và mã lỗi của từng endpoint nằm trong `openapi.yaml` (nguồn chính, dùng để dựng mock). File này ghi các quy tắc nghiệp vụ mà schema không diễn tả được. Quy ước chung trong `CONTRACT.md`. TV2 viết, TV1 duyệt.

## Endpoint

| Nhóm    | Endpoint                                                                                                                     | Chủ |
| ------- | ---------------------------------------------------------------------------------------------------------------------------- | --- |
| Auth    | `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`                                               | TV1 |
| Câu hỏi | `GET/POST /questions`, `POST /questions/import`, `GET/PUT/DELETE /questions/:id`                                             | TV2 |
| Kỳ thi  | `GET/POST /exams`, `POST /exams/join`, `GET/PUT/DELETE /exams/:id`, `POST /exams/:id/publish`                                | TV2 |
| Bài làm | `POST /exams/:id/attempts`, `PUT /attempts/:id/answers/:questionId`, `POST /attempts/:id/submit`, `GET /attempts/:id/result` | TV2 |
| Kết quả | `GET /exams/:id/results`, `GET /exams/:id/stats`, `GET /exams/:id/export?format=xlsx\|pdf`                                   | TV2 |

Phần auth do TV2 phác thảo để frontend dựng mock; TV1 có quyền sửa khi triển khai.

## Quyền

- Sai role → 403 `FORBIDDEN`. Đúng role nhưng tài nguyên không thuộc mình (câu hỏi, kỳ thi của giáo viên khác; bài làm của thí sinh khác) → 404 `NOT_FOUND`, không tiết lộ tài nguyên có tồn tại.
- ADMIN chưa có endpoint riêng trong v1.

## Mã HTTP cho lỗi nghiệp vụ

- 409: xung đột trạng thái dữ liệu — `EMAIL_TAKEN`, `QUESTION_IN_USE`, `EXAM_NOT_EDITABLE`, `ATTEMPT_LIMIT_REACHED`, `ATTEMPT_ALREADY_SUBMITTED`, `ATTEMPT_NOT_SUBMITTED`.
- 422: sai thời điểm — `EXAM_NOT_STARTED`, `EXAM_ENDED`, `SUBMIT_TOO_LATE`.

## Câu hỏi

- Câu hỏi nằm trong kỳ thi khác DRAFT (`inUse: true`) bị khóa sửa/xóa để kết quả cũ không đổi. Muốn sửa thì tạo câu mới.
- Câu hỏi nằm trong bất kỳ kỳ thi nào (kể cả DRAFT) không xóa được.
- Sửa câu hỏi thay toàn bộ đáp án; `options[].id` cũ không còn dùng được.

## Kỳ thi

- Vòng đời: `POST /exams` tạo DRAFT → `POST /exams/:id/publish` chuyển SCHEDULED (mở phòng chờ) → giáo viên gửi `exam:start` qua WebSocket chuyển RUNNING, server đặt `startTime = now`, `endTime = now + durationSec` → hết giờ hoặc giáo viên kết thúc chuyển ENDED.
- Sửa được khi DRAFT hoặc SCHEDULED; xóa chỉ khi DRAFT.
- `endTime` là mốc chung của cả kỳ thi (thi đồng loạt): thí sinh vào muộn vẫn kết thúc cùng lúc.

## Bài làm

- `POST /exams/:id/attempts` là idempotent khi đang có bài IN_PROGRESS: trả lại bài đó với cùng thứ tự xáo trộn (seed lưu ở `attempts.shuffle_seed`). Client gọi lại endpoint này khi tải lại trang.
- Đề gửi cho thí sinh không có `isCorrect` và `explanation`.
- Autosave nhận đến `endTime`. Nộp thủ công nhận đến `endTime + 5 giây`, sau đó `SUBMIT_TOO_LATE`; bài chưa nộp được server tự nộp (AUTO_SUBMITTED, TV3).
- Nộp/chấm idempotent: một bài chỉ chuyển khỏi IN_PROGRESS một lần.

## Chấm điểm

- Một câu được trọn điểm khi tập đáp án chọn trùng khớp tập đáp án đúng; ngược lại 0 điểm. Không có điểm từng phần cho MULTIPLE.
- `score` = tổng điểm câu đúng, `maxScore` = tổng `points` của kỳ thi; làm tròn 2 chữ số.
- Thí sinh thấy điểm ngay khi nộp; đáp án đúng và lời giải chỉ hiện sau khi kỳ thi ENDED (tránh lộ đáp án cho người đang thi).

## Thống kê

- Chỉ tính bài đã nộp. Thí sinh làm nhiều lần thì lấy bài điểm cao nhất.
- Bảng xếp hạng: top 10 theo điểm giảm dần, hòa điểm thì ai làm nhanh hơn xếp trên.

## Import Excel

- Định dạng cột mô tả trong `openapi.yaml` (`POST /questions/import`). Import tất cả hoặc không: một dòng lỗi thì không tạo câu nào, trả danh sách lỗi theo số dòng.

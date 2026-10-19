# Database

`init/001_schema.sql` là schema PostgreSQL 16 ban đầu. Docker Compose tự chạy file này khi tạo **volume PostgreSQL mới** (`docker compose up -d postgres`). Nếu container đã có một database trống, chạy thủ công bằng lệnh dưới đây; thay tên user/database nếu `.env` dùng giá trị khác. File chỉ dành cho database chưa có các bảng này.

```bash
docker compose exec -T postgres psql -U online_exam -d online_exam -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/001_schema.sql
```

Schema gồm các bảng trong contract (`users`, `questions`, `options`, `exams`, `exam_questions`, `attempts`, `answers`, `proctor_logs`) và bảng nối `answer_selected_options` để kiểm tra khóa ngoại của từng lựa chọn. `answers.exam_id` giúp khóa ngoại bảo đảm câu trả lời thuộc đúng kỳ thi của bài làm. API có thể tổng hợp các bản ghi nối thành `selectedOptionIds` khi trả `attempt:state`.

`exams.end_time` là thời điểm kết thúc bền vững để dựng lại timer và job sau khi server khởi động lại. Session, heartbeat, presence và trạng thái phòng tạm thời lưu ở Redis. `proctor_logs.at` là thời gian server nhận event; `client_at` chỉ là dữ liệu tham khảo từ trình duyệt.

Mã phòng theo contract chỉ gồm 6 ký tự in hoa và loại `0`, `O`, `1`, `I`; vì vậy mã ví dụ `DEMO01` trong tài liệu sẽ không qua ràng buộc này. Khi nhóm chuyển sang Prisma migrations, cần baseline schema trước khi tạo migration mới để tránh tạo lại các bảng đang tồn tại.

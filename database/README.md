# Database

Các file `init/NNN_*.sql` là nguồn chính của schema PostgreSQL 16. Docker Compose chạy chúng theo thứ tự tên khi tạo **volume PostgreSQL mới** (`docker compose up -d postgres`). Mỗi file chỉ chạy được một lần; không sửa file đã merge, thay đổi tiếp theo thêm file số mới.

| File                | Nội dung                                                                                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_schema.sql`    | Schema ban đầu                                                                                                                                       |
| `002_exam_core.sql` | `options.order_index`, `updated_at` cho `questions`/`exams`, xóa dây chuyền `options` và `exam_questions`, email duy nhất không phân biệt hoa thường |

Volume đã có từ trước chỉ cần chạy các file mới bằng tay (thay `002_exam_core.sql` bằng file cần chạy; đổi user/database nếu `.env` khác), hoặc xóa volume bằng `docker compose down -v` nếu không cần giữ dữ liệu:

```bash
docker compose exec -T postgres psql -U online_exam -d online_exam -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/002_exam_core.sql
```

`apps/server/prisma/schema.prisma` phản chiếu các file SQL để dùng Prisma Client; chưa dùng Prisma Migrate. Sau khi thêm file SQL, cập nhật `schema.prisma` rồi chạy `pnpm --filter @online-exam/server db:diff`: lệnh phải in `No difference detected`.

Schema gồm các bảng trong contract (`users`, `questions`, `options`, `exams`, `exam_questions`, `attempts`, `answers`, `proctor_logs`) và bảng nối `answer_selected_options` để kiểm tra khóa ngoại của từng lựa chọn. `answers.exam_id` giúp khóa ngoại bảo đảm câu trả lời thuộc đúng kỳ thi của bài làm. API có thể tổng hợp các bản ghi nối thành `selectedOptionIds` khi trả `attempt:state`.

`exams.end_time` là thời điểm kết thúc bền vững để dựng lại timer và job sau khi server khởi động lại. Session, heartbeat, presence và trạng thái phòng tạm thời lưu ở Redis. `proctor_logs.at` là thời gian server nhận event; `client_at` chỉ là dữ liệu tham khảo từ trình duyệt.

Mã phòng theo contract chỉ gồm 6 ký tự in hoa và loại `0`, `O`, `1`, `I`; vì vậy mã ví dụ `DEMO01` trong tài liệu sẽ không qua ràng buộc này. Khi nhóm chuyển sang Prisma Migrate, cần baseline từ các file SQL hiện có trước khi tạo migration mới để tránh tạo lại các bảng đang tồn tại.

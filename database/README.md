# Database

Các file `init/NNN_*.sql` là nguồn chính của schema PostgreSQL 16. Docker Compose chạy chúng theo thứ tự tên khi tạo **volume PostgreSQL mới** (`docker compose up -d postgres`). Mỗi file chỉ chạy được một lần; không sửa file đã merge, thay đổi tiếp theo thêm file số mới.

| File                | Nội dung                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_schema.sql`    | Schema ban đầu                                                                                                                                                   |
| `002_exam_core.sql` | `options.order_index` (đánh số lại đáp án có sẵn, không có giá trị mặc định), `updated_at` cho `questions`/`exams`, xóa dây chuyền `options` và `exam_questions` |

CI chạy lần lượt mọi file trong `init/` trước `pnpm check`. Email được lưu lowercase ở tầng API (`packages/shared/src/auth.ts`), nên database không cần index `lower(email)`.

Volume đã có từ trước chỉ cần chạy các file mới bằng tay (thay `002_exam_core.sql` bằng file cần chạy; đổi user/database nếu `.env` khác), hoặc xóa volume bằng `docker compose down -v` nếu không cần giữ dữ liệu:

```bash
docker compose exec -T postgres psql -U online_exam -d online_exam -v ON_ERROR_STOP=1 -f /docker-entrypoint-initdb.d/002_exam_core.sql
```

`apps/server/prisma/schema.prisma` phản chiếu các file SQL để dùng Prisma Client; chưa dùng Prisma Migrate. Sau khi thêm file SQL, cập nhật `schema.prisma` rồi chạy `pnpm --filter @online-exam/server db:diff`: lệnh phải in `No difference detected`.

## Tài khoản demo local

Sau khi có `.env` ở root với `APP_ENV=dev` và `DATABASE_URL` trỏ tới database local đã áp dụng SQL 001 và 002, chạy tại root:

```powershell
pnpm install --frozen-lockfile
pnpm infra:up
pnpm --filter @online-exam/server db:generate
pnpm --filter @online-exam/server db:seed
```

Script chạy `apps/server/prisma/seed.ts`; không thay đổi schema hoặc reset dữ liệu. Generate Prisma Client một lần trước khi seed, và chạy lại `db:generate` sau khi đổi schema. Tách hai lệnh giúp seed chạy lại khi Prisma Client đang được ứng dụng sử dụng trên Windows. Volume mới tự chạy SQL init. Với volume cũ, chỉ áp dụng file SQL còn thiếu theo hướng dẫn ở trên.

Trên Windows, dùng `127.0.0.1` làm host trong `DATABASE_URL` nếu kết nối `localhost` bị chậm hoặc test transaction timeout.

| Email               | Mật khẩu ban đầu | Role    |
| ------------------- | ---------------- | ------- |
| `teacher@test.com`  | `Test@1234`      | TEACHER |
| `student1@test.com` | `Test@1234`      | STUDENT |

Mật khẩu demo chỉ dành cho môi trường dev và được hash bằng cùng hàm `bcryptPasswords()` của Auth. Đăng ký công khai vẫn chỉ tạo STUDENT; seed cấp tài khoản TEACHER để demo. Script chỉ chấp nhận `APP_ENV=dev`, kể cả khi gọi lại từ code.

Chạy seed nhiều lần không tạo trùng email và không thay đổi ID, tên, role hoặc mật khẩu của tài khoản đã có. Mật khẩu trong bảng trên chỉ áp dụng cho tài khoản mới tạo; seed không reset mật khẩu cũ. Nếu một email demo đã tồn tại với role khác, toàn bộ transaction seed rollback và lệnh trả lỗi; dữ liệu cũ được giữ nguyên. Seed không tạo câu hỏi, kỳ thi hoặc session Redis. Output chỉ gồm ID/email/role.

Để kiểm chứng, chạy seed hai lần rồi khởi động `pnpm dev`. Dùng Postman giữ cookie giữa các request:

1. `POST /api/v1/auth/login` bằng tài khoản TEACHER → 200, response có role TEACHER.
2. `POST /api/v1/questions` bằng cookie đó với body dưới đây → 201.
3. `GET /api/v1/questions` bằng cùng cookie → thấy câu vừa tạo, kể cả sau khi tải lại.
4. Đăng nhập STUDENT và gửi cùng request tạo câu hỏi → 403 `FORBIDDEN`.

```json
{
  "type": "SINGLE",
  "content": "2 + 2 bằng bao nhiêu?",
  "options": [
    { "content": "4", "isCorrect": true },
    { "content": "5", "isCorrect": false }
  ]
}
```

Test `apps/server/tests/integration/dev-seed.test.ts` dùng `AUTH_DATABASE_URL`, tạo schema UUID riêng và sao chép cấu trúc bảng users để kiểm tra seed trên PostgreSQL thật; dọn đúng schema đó sau khi chạy. Test không sửa các tài khoản demo trong database chính.

## Mô hình dữ liệu

Schema gồm các bảng trong contract (`users`, `questions`, `options`, `exams`, `exam_questions`, `attempts`, `answers`, `proctor_logs`) và bảng nối `answer_selected_options` để kiểm tra khóa ngoại của từng lựa chọn. `answers.exam_id` giúp khóa ngoại bảo đảm câu trả lời thuộc đúng kỳ thi của bài làm. API có thể tổng hợp các bản ghi nối thành `selectedOptionIds` khi trả `attempt:state`.

`exams.end_time` là thời điểm kết thúc bền vững để dựng lại timer và job sau khi server khởi động lại. Session, heartbeat, presence và trạng thái phòng tạm thời lưu ở Redis. `proctor_logs.at` là thời gian server nhận event; `client_at` chỉ là dữ liệu tham khảo từ trình duyệt.

Mã phòng theo contract chỉ gồm 6 ký tự in hoa và loại `0`, `O`, `1`, `I`; vì vậy mã ví dụ `DEMO01` trong tài liệu sẽ không qua ràng buộc này. Khi nhóm chuyển sang Prisma Migrate, cần baseline từ các file SQL hiện có trước khi tạo migration mới để tránh tạo lại các bảng đang tồn tại.

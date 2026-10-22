# REST API contract

Base URL: `/api/v1`. Định nghĩa máy đọc được tại `openapi.yaml`; hiện chỉ có health đã triển khai. Quy ước chung trong `CONTRACT.md`. TV2 hoàn thiện request/response của API nghiệp vụ, TV1 duyệt trước khi tích hợp.

Contract chi tiết sẽ được chốt trước khi frontend tích hợp. Các nhóm endpoint dự kiến: `/auth`, `/questions`, `/exams`, `/attempts`, `/results`.

Mỗi endpoint phải nêu rõ role được phép gọi, request/response schema và mã lỗi.
